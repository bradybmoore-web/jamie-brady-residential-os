import "server-only";
import { getProvider } from "@/lib/ai";
import { recordRun } from "@/lib/ai/audit";
import { EvidenceLedger } from "@/lib/ai/grounding";
import {
  MARKETING_PROMPT_VERSION,
  MARKETING_TEMPLATES,
  buildMarketingFacts,
  buildMarketingSystem,
} from "@/lib/ai/prompts/marketing";
import { findProhibited } from "@/lib/ai/prompts/writing";
import { getStore } from "@/lib/data/store";
import type { ListingMarketingAsset, MarketingAssetKind, UUID } from "@/lib/types";

export interface GenerateMarketingResult {
  asset: ListingMarketingAsset;
  usedFallback: boolean;
  provider: "anthropic" | "mock";
  /** Banned or seller-prohibited phrases found in the output. */
  flagged: string[];
}

/**
 * Workflow 4 — the Listing Marketing Studio.
 *
 * One generation path for sixteen content types. The differences live in
 * `MARKETING_TEMPLATES`, so adding "Luxury Magazine Blurb" later is one entry,
 * not a new code path.
 *
 * Output is written as `draft` and must be approved before it counts as
 * published marketing. Copy containing a banned or seller-prohibited phrase is
 * flagged rather than silently shipped.
 */
export async function generateListingMarketing(
  listingId: UUID,
  kind: MarketingAssetKind,
  ownerId: UUID,
  opts?: { instructions?: string },
): Promise<GenerateMarketingResult> {
  const store = await getStore();
  const listing = await store.getListing(listingId);
  if (!listing) throw new Error(`Listing ${listingId} not found`);
  const property = await store.getProperty(listing.propertyId);
  if (!property) throw new Error(`Property ${listing.propertyId} not found`);

  const template = MARKETING_TEMPLATES[kind];
  if (!template) throw new Error(`Unknown marketing content type: ${kind}`);

  const startedAt = performance.now();
  const ledger = new EvidenceLedger()
    .allow("listing", listing.id, `Listing ${property.address}`)
    .allow("contact", listing.sellerContactIds[0] ?? listing.id, "Seller");

  const provider = await getProvider();
  const extra = opts?.instructions?.trim()
    ? `\n\nAdditional direction from Jamie for this specific piece — follow it:\n${opts.instructions.trim()}`
    : "";

  const result = await provider.generateText({
    workflow: "listing_marketing",
    task: `marketing:${kind}`,
    promptVersion: MARKETING_PROMPT_VERSION,
    system: buildMarketingSystem(listing),
    prompt: `${template.brief}${extra}\n\nWrite only the finished piece. No preamble, no explanation, no notes about your choices.`,
    facts: buildMarketingFacts(listing, property),
    maxTokens: template.maxTokens,
    temperature: template.temperature,
    fallback: () => template.fallback(listing, property),
  });

  const flagged = findProhibited(result.value, listing.prohibitedPhrases);

  const run = await recordRun({
    store,
    workflow: "listing_marketing",
    promptVersion: MARKETING_PROMPT_VERSION,
    model: provider.model,
    provider: provider.name,
    ledger,
    ownerId,
    startedAt,
    usage: result.usage,
    error: result.error,
    outputSummary: `${kind} for ${property.address}${flagged.length ? ` — ${flagged.length} phrase(s) flagged` : ""}`,
  });

  const asset = await store.createListingMarketing({
    listingId,
    kind,
    status: "draft",
    content: result.value,
    promptVersion: MARKETING_PROMPT_VERSION,
    aiRunId: run.id,
    ownerId,
    flaggedPhrases: flagged,
    sourceSystem: "ai",
  });

  return { asset, usedFallback: result.usedFallback, provider: provider.name, flagged };
}
