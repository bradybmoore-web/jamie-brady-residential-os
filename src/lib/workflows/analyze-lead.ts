import "server-only";
import { z } from "zod";
import { getProvider } from "@/lib/ai";
import { recordRun } from "@/lib/ai/audit";
import { EvidenceLedger } from "@/lib/ai/grounding";
import { FACTS_RULE } from "@/lib/ai/prompts/writing";
import { getStore } from "@/lib/data/store";
import { teamDayAt } from "@/lib/utils";
import { leadName, type Lead, type LeadType, type UUID, type Urgency } from "@/lib/types";

export const LEAD_PROMPT_VERSION = "analyze_lead@2";

const SYSTEM = `You classify inbound real estate inquiries for Jamie and Brady Moore in Austin, Texas, and draft the first reply.

${FACTS_RULE}

Classification rules:
- "type" is what the person is trying to do. Someone asking what their house is worth is a seller even if
  they also need to buy. Someone asking about a specific listing is a buyer. Someone asking about rental
  income or cap rates is an investor. If you genuinely cannot tell, say "unknown" — do not guess to look decisive.
- "intentConfidence" is how sure you are of the type, from 0 to 1. A one-line "is this still available"
  should be low. A detailed message about timing and motivation should be high.
- "urgency" reflects how soon this person will transact, not how excited the message sounds.
- "reasons" must quote or closely paraphrase what they actually wrote. Do not add motivations they did not state.
- Never state a home value, a price, a commission, or a market statistic. You do not have that data.

The suggested response:
- Short. Four to six sentences. It is a first reply, not a listing presentation.
- Answer the question they actually asked, or say plainly that you will find out.
- Ask exactly one question back — the one that most changes what happens next.
- No "I hope this finds you well". No "reaching out". No pressure.
- Sign as Jamie Moore.`;

const AnalysisSchema = z.object({
  type: z.enum(["buyer", "seller", "investor", "renter", "unknown"]),
  intentConfidence: z.number().min(0).max(1),
  location: z.string().nullable(),
  timeline: z.string().nullable(),
  urgency: z.enum(["low", "medium", "high", "critical"]),
  reasons: z.array(z.string()).min(1).max(6),
  nextAction: z.string(),
  suggestedResponse: z.string(),
  summary: z.string(),
});

export type LeadAnalysis = z.infer<typeof AnalysisSchema>;

export interface AnalyzeLeadResult {
  analysis: LeadAnalysis;
  score: number;
  lead: Lead;
  aiRunId: UUID;
  draftActionId: UUID | null;
  usedFallback: boolean;
}

/**
 * Workflow 2 — lead intake.
 *
 * Extraction from free text is a genuine language task, so the model does the
 * classification here. The *score* is not the model's to decide: it is computed
 * from the extracted structure plus hard facts (source quality, contactability,
 * response time), so ranking stays stable and explainable.
 */
export async function analyzeLead(
  leadId: UUID,
  ownerId: UUID,
  opts?: { persist?: boolean },
): Promise<AnalyzeLeadResult> {
  const store = await getStore();
  const lead = await store.getLead(leadId);
  if (!lead) throw new Error(`Lead ${leadId} not found`);

  const startedAt = performance.now();
  const ledger = new EvidenceLedger().allow("lead", lead.id, `Lead ${leadName(lead)}`);

  const provider = await getProvider();
  const result = await provider.generateStructured({
    workflow: "analyze_lead",
    task: "classify_and_draft",
    promptVersion: LEAD_PROMPT_VERSION,
    system: SYSTEM,
    prompt:
      "Classify this inquiry and draft the first reply. Return a single JSON object with keys: type, intentConfidence, location, timeline, urgency, reasons, nextAction, suggestedResponse, summary.",
    facts: {
      firstName: lead.firstName,
      lastName: lead.lastName,
      source: lead.source,
      receivedAt: lead.inquiredAt,
      hasPhone: Boolean(lead.phone),
      message: lead.inquiryContent,
      propertyAddress: lead.propertyAddress,
      previousAttempts: lead.attemptCount,
      agent: "Jamie Moore, Moore Residential Group, Austin TX",
    },
    schema: AnalysisSchema,
    maxTokens: 1200,
    temperature: 0.3,
    fallback: () => heuristicAnalysis(lead),
  });

  const analysis = result.value;
  const score = scoreLead(lead, analysis);

  const run = await recordRun({
    store,
    workflow: "analyze_lead",
    promptVersion: LEAD_PROMPT_VERSION,
    model: provider.model,
    provider: provider.name,
    ledger,
    ownerId,
    startedAt,
    usage: result.usage,
    error: result.error,
    outputSummary: `${leadName(lead)} classified as ${analysis.type} (${Math.round(analysis.intentConfidence * 100)}% confidence), score ${score}`,
  });

  let draftActionId: UUID | null = null;
  let updated = lead;

  if (opts?.persist !== false) {
    // Re-analysing supersedes the previous draft. A queue that accumulates
    // three versions of the same reply is a queue Jamie stops reading.
    for (const existing of await store.listAIActions()) {
      if (existing.leadId !== lead.id) continue;
      if (existing.workflow !== "analyze_lead") continue;
      if (existing.status !== "needs_review" && existing.status !== "draft") continue;
      await store.updateAIAction(existing.id, {
        status: "rejected",
        rejectionReason: "Superseded by a newer analysis of this lead.",
        reviewedAt: new Date().toISOString(),
      });
    }

    // The drafted reply becomes an approval item. Nothing is ever sent from here.
    const action = await store.createAIAction({
      aiRunId: run.id,
      workflow: "analyze_lead",
      type: "email_draft",
      status: "needs_review",
      title: `Reply to ${leadName(lead)}`,
      body: analysis.suggestedResponse,
      subject: draftSubject(lead, analysis),
      recipient: lead.email ?? null,
      leadId: lead.id,
      contactId: lead.contactId ?? null,
      confidence: analysis.intentConfidence,
      evidence: [
        {
          label: "Original inquiry",
          detail: lead.inquiryContent,
          recordType: "lead",
          recordId: lead.id,
          occurredAt: lead.inquiredAt,
        },
      ],
      ownerId,
      requiresApproval: true,
      sourceSystem: "ai",
    });
    draftActionId = action.id;

    updated = await store.updateLead(lead.id, {
      type: analysis.type as LeadType,
      urgency: analysis.urgency as Urgency,
      score,
      desiredArea: lead.desiredArea ?? analysis.location,
      estimatedTimeline: lead.estimatedTimeline ?? analysis.timeline,
      aiSummary: analysis.summary,
      aiRecommendedAction: analysis.nextAction,
      draftedResponse: analysis.suggestedResponse,
      analysisRunId: run.id,
    });
  }

  return { analysis, score, lead: updated, aiRunId: run.id, draftActionId, usedFallback: result.usedFallback };
}

/* --------------------------------------------------------------- scoring */

/**
 * Lead score, 0-100. Deterministic on purpose — a lead's rank should not move
 * because the model was feeling generous.
 */
export function scoreLead(lead: Lead, analysis: LeadAnalysis): number {
  let score = 30;

  // Intent clarity.
  score += Math.round(analysis.intentConfidence * 22);
  if (analysis.type === "seller") score += 12;
  else if (analysis.type === "buyer") score += 8;
  else if (analysis.type === "investor") score += 5;
  else if (analysis.type === "unknown") score -= 12;

  // Urgency.
  score += { critical: 20, high: 14, medium: 6, low: 0 }[analysis.urgency];

  // Source quality. A referral behaves nothing like a portal lead.
  const source = lead.source.toLowerCase();
  if (source.includes("referral")) score += 16;
  else if (source.includes("website") || source.includes("contact form")) score += 8;
  else if (source.includes("open house")) score += 7;
  else if (source.includes("activepipe")) score += 4;
  else if (source.includes("zillow") || source.includes("realtor")) score -= 4;

  // Contactability and substance.
  if (lead.phone) score += 6;
  if (lead.inquiryContent.length > 200) score += 6;
  else if (lead.inquiryContent.length < 40) score -= 10;
  if (lead.priceRangeMin || lead.priceRangeMax) score += 4;

  // Repeated failed attempts mean this is getting harder, not more valuable.
  score -= Math.min(12, lead.attemptCount * 4);

  return Math.max(0, Math.min(100, score));
}

/* ------------------------------------------------------------- heuristics */

/*
 * Keyword sets for the no-API-key path.
 *
 * Split into strong and weak signals. A strong signal states intent outright
 * ("what is our house worth", "can we tour it"). A weak one is merely
 * consistent with it ("is this available") — and on a four-word message that is
 * not enough to classify anyone. Guessing confidently from "is this still
 * available?" is exactly the failure mode this split exists to prevent.
 *
 * Stems are written as `sell\w*` rather than `\bsell\b`: a trailing word
 * boundary silently fails to match "selling" or "relocating", which is a
 * mistake that reads as correct.
 */
const STRONG_SELLER =
  /\b(what(?:'s| is| would)?\s+(?:my|our)\s+(?:home|house|place)\b[^.?!]{0,30}\bworth|home value|house value|sell(?:ing)?\s+(?:my|our)|thinking about selling|list(?:ing)?\s+(?:my|our)|market analysis|\bcma\b|we(?:'ve| have)? decided to sell)/i;
const WEAK_SELLER = /\b(sell\w*|list\w*|worth|value|equity|appraisal)\b/i;

const STRONG_BUYER =
  /\b(tour\w*|showing\w*|see (?:it|this|the (?:house|property|home))|pre-?approv\w*|pre-?qualif\w*|look(?:ing|ed)?\s+(?:for|in|at)\s|relocat\w*|mov(?:e|ing)\s+to|buy\w*|purchas\w*|in the market for)/i;
const WEAK_BUYER = /\b(available|interested|inquir\w*|schedule|visit)\b/i;

const INVESTOR_PATTERNS =
  /\b(rental|cap rate|cash flow|short.?term rental|airbnb|investment|investor|\broi\b|rent it out|door)\b/i;
const RENTER_PATTERNS = /\b(lease|renting|monthly rent|tenant|for rent)\b/i;

const URGENT_PATTERNS =
  /\b(asap|immediately|this week|urgent|right away|by (?:the )?(?:end of|year|month)|need to be|must be|has to be)\b/i;
const SOON_PATTERNS = /\b(next (?:month|few months)|\d{2,3}\s*[-–]\s*\d{2,3}\s*days?|within \d+ (?:days|weeks|months))\b/i;
const NO_RUSH_PATTERNS =
  /\b(no rush|not in a hurry|eventually|someday|a couple of years|12\+? months|nothing imminent|down the road)\b/i;

/** Below this, a message is too thin to classify from weak signals alone. */
const THIN_MESSAGE_CHARS = 60;

/**
 * The no-API-key path. Keyword extraction plus the same scoring rules — crude
 * next to a model, but honest, fast and good enough to triage.
 */
export function heuristicAnalysis(lead: Lead): LeadAnalysis {
  const text = lead.inquiryContent;
  const isThin = text.trim().length < THIN_MESSAGE_CHARS;
  const reasons: string[] = [];

  let type: LeadAnalysis["type"] = "unknown";
  let confidence = 0.35;

  if (INVESTOR_PATTERNS.test(text)) {
    type = "investor";
    confidence = 0.72;
    reasons.push("Asked about rental income or investment return");
  } else if (RENTER_PATTERNS.test(text)) {
    type = "renter";
    confidence = 0.65;
    reasons.push("Asked about leasing rather than buying");
  } else if (STRONG_SELLER.test(text)) {
    type = "seller";
    confidence = 0.82;
    reasons.push("Asked directly about their home's value or about selling");
    if (STRONG_BUYER.test(text)) reasons.push("Will also need to buy a replacement home");
  } else if (STRONG_BUYER.test(text)) {
    type = "buyer";
    confidence = 0.78;
    reasons.push("Asked about seeing or buying a property");
  } else if (!isThin && WEAK_SELLER.test(text)) {
    type = "seller";
    confidence = 0.55;
    reasons.push("Language points toward selling, though they did not say so outright");
  } else if (!isThin && WEAK_BUYER.test(text)) {
    type = "buyer";
    confidence = 0.52;
    reasons.push("Language points toward buying, though they did not say so outright");
  } else {
    reasons.push(
      isThin
        ? "Message is too short to tell what they are trying to do"
        : "Nothing in the message states what they are trying to do",
    );
  }

  if (lead.propertyAddress) reasons.push(`Inquiry references ${lead.propertyAddress}`);
  if (/\bpre-?approv\w*|pre-?qualif\w*|\bcash\b/i.test(text)) {
    reasons.push("Says their financing is already in place");
    confidence = Math.min(0.95, confidence + 0.08);
  }

  let urgency: LeadAnalysis["urgency"] = "medium";
  if (NO_RUSH_PATTERNS.test(text)) {
    urgency = "low";
    reasons.push("Explicitly said there is no time pressure");
  } else if (URGENT_PATTERNS.test(text)) {
    urgency = "critical";
    reasons.push("Stated a hard deadline");
  } else if (SOON_PATTERNS.test(text) || lead.estimatedTimeline) {
    urgency = "high";
  }

  const location =
    lead.desiredArea ??
    text.match(/\b(?:in|near|around) ([A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+){0,2})\b/)?.[1] ??
    (lead.propertyAddress ? (lead.propertyAddress.split(",")[1]?.trim() ?? null) : null);

  const timeline =
    lead.estimatedTimeline ??
    text.match(/\b(\d{2,3}\s*[-–]\s*\d{2,3}\s*days?|next \w+|by (?:the )?(?:end of )?\w+|\d+\+? months?)\b/i)?.[0] ??
    null;

  return {
    type,
    intentConfidence: Number(confidence.toFixed(2)),
    location,
    timeline,
    urgency,
    reasons: reasons.slice(0, 6),
    nextAction:
      urgency === "critical" || urgency === "high"
        ? lead.phone
          ? "Call today"
          : "Email today and ask for a phone number"
        : "Reply today, then add to the nurture sequence",
    summary: heuristicSummary(lead, type, urgency, location, timeline),
    suggestedResponse: heuristicResponse(lead, type),
  };
}

function heuristicSummary(
  lead: Lead,
  type: LeadAnalysis["type"],
  urgency: LeadAnalysis["urgency"],
  location: string | null,
  timeline: string | null,
) {
  const parts = [
    `${leadName(lead)} came in through ${lead.source}`,
    type === "unknown" ? "with intent that is not yet clear" : `as a ${type}`,
  ];
  if (location) parts.push(`focused on ${location}`);
  if (timeline) parts.push(`on a ${timeline} timeline`);
  parts.push(`${urgency} urgency`);
  return `${parts.join(", ")}.`;
}

function heuristicResponse(lead: Lead, type: LeadAnalysis["type"]) {
  const first = lead.firstName;
  const sign = "\n\nJamie Moore\nMoore Residential Group\n(512) 555-0142";

  if (type === "seller") {
    return `Hi ${first},\n\nThanks for reaching out. Happy to help you figure out where your house stands — and since you would also need somewhere to land, that second half is worth planning at the same time. Doing them in the wrong order is what makes this stressful.\n\nI can put together what your house would realistically sell for right now, based on what has actually closed nearby rather than an automated estimate. To do that well I need ten minutes of your time and a quick look at the house.\n\nWhat does your week look like?${sign}`;
  }
  if (type === "buyer") {
    const property = lead.propertyAddress ? ` about ${lead.propertyAddress}` : "";
    return `Hi ${first},\n\nThanks for reaching out${property}. I can get you in to see it, and I would also pull two or three others worth your time so you have something to compare it against — one house on its own tells you very little.\n\nBefore I send anything, one question: what is driving the timing on this move?\n\nThat answer changes what I show you more than anything else.${sign}`;
  }
  if (type === "investor") {
    return `Hi ${first},\n\nThanks for reaching out. I can get you the specifics on what is and is not allowed there — POA and city rules vary more than people expect, and it is the kind of thing you want in writing before you write an offer, not after.\n\nWhat return are you underwriting to? That tells me whether the properties I am seeing are worth sending you.${sign}`;
  }
  return `Hi ${first},\n\nThanks for reaching out. Before I send you anything useful, tell me a little about what you are trying to do — buying, selling, or still working that out. Any of those is fine, they just point in different directions.\n\nHappy to talk today if that is easier.${sign}`;
}

function draftSubject(lead: Lead, analysis: LeadAnalysis) {
  if (lead.propertyAddress) return `Re: ${lead.propertyAddress}`;
  if (analysis.type === "seller") return `Your home in ${analysis.location ?? "Austin"}`;
  if (analysis.type === "buyer") return `Looking in ${analysis.location ?? "Austin"}`;
  return "Following up on your note";
}

/** Standard follow-up cadence after an attempt, used when a lead is worked. */
export function nextFollowUpAt(attemptCount: number) {
  const days = [0, 1, 2, 4, 7, 14][Math.min(attemptCount, 5)];
  return teamDayAt(days === 0 ? 0 : days, 9);
}
