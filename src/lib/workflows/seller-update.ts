import "server-only";
import { z } from "zod";
import { getProvider } from "@/lib/ai";
import { recordRun } from "@/lib/ai/audit";
import { EvidenceLedger } from "@/lib/ai/grounding";
import { FACTS_RULE } from "@/lib/ai/prompts/writing";
import { getStore } from "@/lib/data/store";
import { getMlsProvider } from "@/lib/integrations/mls";
import { daysBetween, formatCurrency, teamDayAt } from "@/lib/utils";
import type { SellerUpdate, SellerUpdateMarketContext, UUID } from "@/lib/types";

export const SELLER_UPDATE_PROMPT_VERSION = "seller_update@2";

const SYSTEM = `You write the weekly seller update for Jamie Moore, a luxury residential agent in Austin, Texas.

${FACTS_RULE}

The update has three parts and they must stay separate, because a seller deserves to know which is which:

1. FACTS — what happened. Numbers and events only. No adjectives, no reassurance, no spin.
2. MARKET INTERPRETATION — what you think it means, stated as a reading and not as truth.
   Use language like "this suggests", "the most likely explanation is", "read together, these point to".
   Never present an interpretation as a fact.
3. RECOMMENDED ACTION — what you would do, and why, and what happens if they do nothing.

Then write the message to the seller.

Rules for the message:
- Address the sellers by name, in Jamie's voice, in first person.
- Lead with the truth even when it is unwelcome. A seller who finds out late stops trusting you.
- Do not use "great news", "exciting", "unfortunately", or "just wanted to update you".
- Never promise a result, a timeline, or a price.
- If the honest recommendation is a price reduction, say so directly and give the reasoning.
- Six to twelve sentences. Sellers read these on their phone.`;

const UpdateSchema = z.object({
  marketInterpretation: z.string(),
  recommendedAction: z.string(),
  draftMessage: z.string(),
});

export interface SellerUpdateResult {
  update: SellerUpdate;
  usedFallback: boolean;
  provider: "anthropic" | "mock";
}

/**
 * The seller update foundation.
 *
 * FACTS are computed here from showings, feedback, portal engagement, inquiries
 * and the competitive set — never written by the model. The model reads those
 * facts and supplies the interpretation, the recommendation and the message.
 * Keeping the boundary sharp is the whole point: sellers make expensive
 * decisions from these, and they need to know which sentences are measurements
 * and which are opinions.
 */
export async function generateSellerUpdate(
  listingId: UUID,
  ownerId: UUID,
  opts?: { now?: Date },
): Promise<SellerUpdateResult> {
  const store = await getStore();
  const now = opts?.now ?? new Date();
  const listing = await store.getListing(listingId);
  if (!listing) throw new Error(`Listing ${listingId} not found`);
  const property = await store.getProperty(listing.propertyId);
  if (!property) throw new Error(`Property ${listing.propertyId} not found`);

  const startedAt = performance.now();
  const allFeedback = await store.listShowingFeedback();
  const periodStart = new Date(now.getTime() - listing.sellerUpdateCadenceDays * 86_400_000).toISOString();
  const feedback = allFeedback.filter(
    (f) => f.listingId === listingId && f.showingAt >= periodStart && f.showingAt <= now.toISOString(),
  );

  // Competitive context. The MLS adapter is mocked until a licensed feed exists;
  // the shape is what a RESO provider returns, so swapping it changes nothing here.
  const mls = await getMlsProvider();
  const comparables = await mls.getComparables({
    postalCode: property.postalCode,
    beds: property.beds ?? undefined,
    priceMin: Math.round(listing.listPrice * 0.82),
    priceMax: Math.round(listing.listPrice * 1.18),
    withinDays: 90,
  });

  const daysOnMarket = listing.listedAt ? daysBetween(listing.listedAt, now) : 0;
  const marketContext: SellerUpdateMarketContext = {
    competingActives: comparables.actives.length,
    competingPriceReductions: comparables.priceReductions.length,
    newPendings: comparables.pendings.length,
    recentSolds: comparables.solds.length,
    medianCompetingPrice: median(comparables.actives.map((a) => a.listPrice)),
    daysOnMarket,
  };

  const facts = buildFacts(listing, property, feedback, marketContext);

  const ledger = new EvidenceLedger().allow("listing", listing.id, `Listing ${property.address}`);
  ledger.allowMany("showing_feedback", feedback, (r) => `Showing feedback ${r.id}`);
  for (const sellerId of listing.sellerContactIds) ledger.allow("contact", sellerId, `Seller ${sellerId}`);

  const provider = await getProvider();
  const result = await provider.generateStructured({
    workflow: "seller_update",
    task: "weekly_update",
    promptVersion: SELLER_UPDATE_PROMPT_VERSION,
    system: SYSTEM,
    prompt:
      'Write this week\'s seller update. Return JSON with exactly these keys: { "marketInterpretation": "...", "recommendedAction": "...", "draftMessage": "..." }. The FACTS have already been computed and are in the facts block — do not restate them as your own analysis, and do not add facts of your own.',
    facts: {
      sellers: listing.sellerNames,
      address: property.address,
      listPrice: listing.listPrice,
      originalListPrice: listing.originalListPrice,
      status: listing.status,
      daysOnMarket,
      computedFacts: facts,
      showingFeedback: feedback.map((f) => ({
        when: f.showingAt,
        agent: f.agentName,
        impression: f.buyerImpression,
        priceReaction: f.priceReaction,
        comments: f.comments,
      })),
      market: marketContext,
      competingActives: comparables.actives.map((a) => ({
        address: a.address,
        listPrice: a.listPrice,
        beds: a.beds,
        squareFeet: a.squareFeet,
        daysOnMarket: a.daysOnMarket,
      })),
      recentSolds: comparables.solds.map((s) => ({
        address: s.address,
        closePrice: s.closePrice,
        closeDate: s.closeDate,
        daysOnMarket: s.daysOnMarket,
      })),
      sellerNotes: listing.writingNotes,
    },
    schema: UpdateSchema,
    maxTokens: 1600,
    temperature: 0.55,
    fallback: () => fallbackUpdate(listing.sellerNames, property.address, facts, feedback, marketContext, listing),
  });

  const run = await recordRun({
    store,
    workflow: "seller_update",
    promptVersion: SELLER_UPDATE_PROMPT_VERSION,
    model: provider.model,
    provider: provider.name,
    ledger,
    ownerId,
    startedAt,
    usage: result.usage,
    error: result.error,
    outputSummary: `Seller update for ${property.address}: ${feedback.length} showings, ${marketContext.competingActives} competing actives`,
  });

  const update = await store.createSellerUpdate({
    listingId,
    periodStart,
    periodEnd: now.toISOString(),
    dueAt: teamDayAt(0, 9, 0, now),
    status: "needs_review",
    facts,
    marketInterpretation: result.value.marketInterpretation,
    recommendedAction: result.value.recommendedAction,
    draftMessage: result.value.draftMessage,
    marketContext,
    feedbackIds: feedback.map((f) => f.id),
    aiRunId: run.id,
    sourceSystem: "ai",
  });

  return { update, usedFallback: result.usedFallback, provider: provider.name };
}

/* ----------------------------------------------------------------- facts */

function buildFacts(
  listing: { showingsThisWeek: number; totalShowings: number; inquiriesThisWeek: number; portalViewsThisWeek: number; savesThisWeek: number; listPrice: number; originalListPrice: number },
  property: { address: string },
  feedback: { buyerImpression: string; priceReaction: string }[],
  market: SellerUpdateMarketContext,
): string[] {
  const facts = [
    `${listing.showingsThisWeek} ${listing.showingsThisWeek === 1 ? "showing" : "showings"} this period (${listing.totalShowings} since launch).`,
    `${listing.portalViewsThisWeek} portal views and ${listing.savesThisWeek} saves.`,
    `${listing.inquiriesThisWeek} ${listing.inquiriesThisWeek === 1 ? "inquiry" : "inquiries"} this period.`,
    `${market.daysOnMarket} days on market.`,
  ];

  if (feedback.length > 0) {
    const overPriced = feedback.filter((f) => f.priceReaction === "over").length;
    const positive = feedback.filter((f) => f.buyerImpression === "positive").length;
    facts.push(`${feedback.length} showing ${feedback.length === 1 ? "response" : "responses"} received: ${positive} positive, ${overPriced} citing price above market.`);
  } else {
    facts.push("No showing feedback was returned this period.");
  }

  facts.push(
    `${market.competingActives} competing active ${market.competingActives === 1 ? "listing" : "listings"}${market.medianCompetingPrice ? ` at a median of ${formatCurrency(market.medianCompetingPrice)}` : ""}.`,
    `${market.competingPriceReductions} competing ${market.competingPriceReductions === 1 ? "listing has" : "listings have"} reduced price.`,
    `${market.newPendings} new ${market.newPendings === 1 ? "pending" : "pendings"} and ${market.recentSolds} recent ${market.recentSolds === 1 ? "sale" : "sales"} in the comparable set.`,
  );

  if (listing.listPrice < listing.originalListPrice) {
    facts.push(
      `Currently ${formatCurrency(listing.listPrice)}, adjusted from ${formatCurrency(listing.originalListPrice)}.`,
    );
  }

  return facts;
}

function fallbackUpdate(
  sellerNames: string,
  address: string,
  facts: string[],
  feedback: { priceReaction: string; comments: string }[],
  market: SellerUpdateMarketContext,
  listing: { showingsThisWeek: number; listPrice: number },
) {
  const priceObjections = feedback.filter((f) => f.priceReaction === "over").length;
  const priceIsTheIssue = priceObjections >= 2 || (listing.showingsThisWeek === 0 && market.daysOnMarket > 30);

  const interpretation = priceIsTheIssue
    ? `Read together, the showing responses point toward price rather than presentation. ${priceObjections} of ${feedback.length || "the"} showings raised price specifically, and with ${market.competingActives} competing actives, buyers have somewhere else to go. This is a reading of the pattern, not a certainty — but the pattern is consistent.`
    : listing.showingsThisWeek === 0
      ? `No showings in the period is the number that matters. With ${market.competingActives} competing actives, the most likely explanation is that the house is not making the first cut on price or photography rather than losing in person.`
      : `Activity is steady. The most useful signal is the ${market.newPendings} new ${market.newPendings === 1 ? "pending" : "pendings"} in the comparable set — those are the properties buyers actually chose, and they set the reference point for anyone looking at this one.`;

  const action = priceIsTheIssue
    ? `Recommend a price conversation this week. Holding at ${formatCurrency(listing.listPrice)} while competing inventory adjusts usually costs more than moving early. If we do nothing, the likely outcome is more of the same showings with the same objection.`
    : `Recommend holding the current price through the next two showings and reassessing with fresh feedback. Nothing in this period justifies a change yet.`;

  const message = `${sellerNames.split("&")[0].trim()} —

Here is where ${address} stands this week.

${facts.map((f) => `• ${f}`).join("\n")}

${interpretation}

${action}

Tell me when you have twenty minutes and we can talk it through properly.

Jamie`;

  return { marketInterpretation: interpretation, recommendedAction: action, draftMessage: message };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}
