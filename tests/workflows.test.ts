import { beforeEach, describe, expect, it } from "vitest";
import { getStore } from "@/lib/data/store";
import { buildSeedDataset } from "@/lib/data/seed";
import { ID } from "@/lib/data/ids";
import { dailyCommandCenter } from "@/lib/workflows/daily-command-center";
import { identifyFollowUpOpportunities } from "@/lib/workflows/follow-up";
import { generateListingMarketing } from "@/lib/workflows/listing-marketing";
import { generateSellerUpdate } from "@/lib/workflows/seller-update";
import { prepareAppointment } from "@/lib/workflows/appointment-prep";
import { analyzeLead } from "@/lib/workflows/analyze-lead";
import { runAssistant } from "@/lib/workflows/assistant";
import { findProhibited } from "@/lib/ai/prompts/writing";
import { MARKETING_KIND_LABELS, type MarketingAssetKind } from "@/lib/types";

/**
 * End-to-end workflow tests against the real in-memory store and the
 * deterministic AI provider. This is the configuration the product ships in
 * before any credential exists, so it is the configuration that must work.
 */

const DATASET_KEY = Symbol.for("residential-os.memory-dataset");

beforeEach(() => {
  // Each test starts from a clean seed; workflows mutate the store.
  (globalThis as Record<symbol, unknown>)[DATASET_KEY] = buildSeedDataset();
});

describe("dailyCommandCenter", () => {
  it("produces a complete brief with no API key", async () => {
    const { brief, provider } = await dailyCommandCenter(ID.jamie, { force: true });

    expect(provider).toBe("mock");
    expect(brief.peopleNeedingAttention.length).toBeGreaterThan(3);
    expect(brief.appointments.length).toBeGreaterThan(0);
    expect(brief.listingActions.length).toBeGreaterThan(0);
    expect(brief.metrics.tasksDue).toBeGreaterThan(0);
    expect(brief.topPriorities).toHaveLength(3);
  });

  it("gives every priority a suggested opener good enough to read off the screen", async () => {
    const { brief } = await dailyCommandCenter(ID.jamie, { force: true });
    for (const priority of brief.peopleNeedingAttention) {
      expect(priority.suggestedMessage.length).toBeGreaterThan(30);
      expect(priority.suggestedMessage.toLowerCase()).not.toContain("hope this finds you well");
      expect(priority.suggestedMessage.toLowerCase()).not.toContain("just checking in");
    }
  });

  it("only cites records it actually read", async () => {
    const { brief } = await dailyCommandCenter(ID.jamie, { force: true });
    const store = await getStore();
    const run = (await store.listAIRuns()).find((r) => r.id === brief.aiRunId)!;
    const allowed = new Set(run.inputRecordIds.map((r) => `${r.recordType}:${r.recordId}`));

    for (const priority of brief.peopleNeedingAttention) {
      for (const reference of priority.sourceReferences) {
        expect(allowed.has(`${reference.recordType}:${reference.recordId}`)).toBe(true);
      }
    }
  });

  it("caches the brief for the day instead of re-running per page view", async () => {
    const first = await dailyCommandCenter(ID.jamie, { force: true });
    const second = await dailyCommandCenter(ID.jamie);
    expect(second.brief.id).toBe(first.brief.id);

    const store = await getStore();
    expect((await store.listAIRuns()).filter((r) => r.workflow === "daily_command_center")).toHaveLength(1);
  });

  it("records an audit row naming the workflow, prompt version and model", async () => {
    await dailyCommandCenter(ID.jamie, { force: true });
    const store = await getStore();
    const run = (await store.listAIRuns())[0];
    expect(run.workflow).toBe("daily_command_center");
    expect(run.promptVersion).toMatch(/^daily_command_center@/);
    expect(run.status).toBe("success");
    expect(run.inputRecordIds.length).toBeGreaterThan(10);
  });

  it("warns that the language is templated when no model is configured", async () => {
    const { brief } = await dailyCommandCenter(ID.jamie, { force: true });
    expect(brief.warnings.join(" ")).toMatch(/no anthropic key/i);
  });
});

describe("identifyFollowUpOpportunities", () => {
  it("finds relationship opportunities with grounded evidence", async () => {
    const { opportunities } = await identifyFollowUpOpportunities(ID.jamie);
    expect(opportunities.length).toBeGreaterThan(4);
    for (const opportunity of opportunities) {
      expect(opportunity.whyNow.length).toBeGreaterThan(15);
      expect(opportunity.suggestedConversationStarter.length).toBeGreaterThan(30);
      expect(opportunity.supportingEvidence.length).toBeGreaterThan(0);
      expect(opportunity.confidence).toBeGreaterThan(0);
      expect(opportunity.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("does not resurrect an opportunity the user dismissed", async () => {
    const store = await getStore();
    const first = await identifyFollowUpOpportunities(ID.jamie);
    const target = first.opportunities.find((o) => o.contactId === ID.collins)!;
    await store.updateOpportunity(target.id, { status: "dismissed" });

    const second = await identifyFollowUpOpportunities(ID.jamie);
    expect(second.opportunities.some((o) => o.contactId === ID.collins)).toBe(false);
  });
});

describe("generateListingMarketing", () => {
  it("writes every content type without an API key", async () => {
    for (const kind of Object.keys(MARKETING_KIND_LABELS) as MarketingAssetKind[]) {
      const { asset } = await generateListingMarketing(ID.lothianListing, kind, ID.jamie);
      expect(asset.content.length, kind).toBeGreaterThan(20);
      expect(asset.status).toBe("draft");
      expect(asset.kind).toBe(kind);
    }
  });

  it("never approves generated copy on its own", async () => {
    const { asset } = await generateListingMarketing(ID.lothianListing, "instagram_caption", ID.jamie);
    expect(asset.status).toBe("draft");
    expect(asset.approvedAt).toBeUndefined();
  });

  it("respects the seller's prohibited phrases in the fallback templates", async () => {
    const store = await getStore();
    const listing = (await store.getListing(ID.lothianListing))!;
    for (const kind of ["mls_description", "instagram_caption", "price_adjustment_post"] as MarketingAssetKind[]) {
      const { asset } = await generateListingMarketing(ID.lothianListing, kind, ID.jamie);
      expect(findProhibited(asset.content, listing.prohibitedPhrases), `${kind}: ${asset.content}`).toEqual([]);
    }
  });

  it("flags banned phrases rather than shipping them silently", async () => {
    const store = await getStore();
    const { asset } = await generateListingMarketing(ID.lothianListing, "mls_description", ID.jamie);
    // Simulate a human pasting stock copy in.
    const flagged = findProhibited("This stunning home boasts a chef's kitchen.", []);
    expect(flagged.length).toBeGreaterThan(0);
    expect(await store.getListingMarketing(asset.id)).not.toBeNull();
  });
});

describe("generateSellerUpdate", () => {
  it("separates measured facts from interpretation and recommendation", async () => {
    const { update } = await generateSellerUpdate(ID.lothianListing, ID.jamie);

    expect(update.facts.length).toBeGreaterThan(4);
    expect(update.marketInterpretation.length).toBeGreaterThan(50);
    expect(update.recommendedAction.length).toBeGreaterThan(30);
    expect(update.draftMessage).toContain("Karen");
    expect(update.status).toBe("needs_review");
  });

  it("states the interpretation as a reading, never as fact", async () => {
    const { update } = await generateSellerUpdate(ID.lothianListing, ID.jamie);
    expect(update.marketInterpretation.toLowerCase()).toMatch(
      /suggests|most likely|point(s)? toward|read together|explanation/,
    );
  });

  it("carries the competitive context from the MLS adapter", async () => {
    const { update } = await generateSellerUpdate(ID.lothianListing, ID.jamie);
    expect(update.marketContext.competingActives).toBeGreaterThan(0);
    expect(update.marketContext.daysOnMarket).toBeGreaterThan(0);
  });

  it("never promises a result in the draft message", async () => {
    const { update } = await generateSellerUpdate(ID.lothianListing, ID.jamie);
    expect(update.draftMessage.toLowerCase()).not.toMatch(/i guarantee|we will definitely|is certain to sell/);
  });
});

describe("prepareAppointment", () => {
  it("builds a brief and marks the appointment prepared", async () => {
    const store = await getStore();
    const event = (await store.listCalendarEvents()).find((e) => e.contactIds.length > 0)!;
    const { prep } = await prepareAppointment(event.id, ID.jamie);

    expect(prep.contactSummary.length).toBeGreaterThan(30);
    expect(prep.talkingPoints.length).toBeGreaterThan(1);
    expect(prep.outstandingQuestions.length).toBeGreaterThan(0);
    expect(prep.evidence.length).toBeGreaterThan(0);

    expect((await store.getCalendarEvent(event.id))!.prepStatus).toBe("prepared");
  });
});

describe("analyzeLead", () => {
  it("classifies, scores, and leaves the reply waiting for approval", async () => {
    const store = await getStore();
    const { analysis, score, draftActionId } = await analyzeLead(ID.leadReyes, ID.jamie);

    expect(analysis.type).toBe("seller");
    expect(score).toBeGreaterThan(50);
    expect(draftActionId).toBeTruthy();

    const action = (await store.getAIAction(draftActionId!))!;
    expect(action.status).toBe("needs_review");
    expect(action.requiresApproval).toBe(true);
    expect(action.executedAt).toBeUndefined();
  });

  it("writes the analysis back onto the lead", async () => {
    const store = await getStore();
    await analyzeLead(ID.leadReyes, ID.jamie);
    const lead = (await store.getLead(ID.leadReyes))!;
    expect(lead.aiSummary).toBeTruthy();
    expect(lead.aiRecommendedAction).toBeTruthy();
    expect(lead.draftedResponse).toBeTruthy();
    expect(lead.analysisRunId).toBeTruthy();
  });
});

describe("assistant", () => {
  it("answers from the real tools rather than from nothing", async () => {
    const result = await runAssistant([{ role: "user", content: "Which relationships are going cold?" }], ID.jamie);
    expect(result.steps.length).toBeGreaterThan(0);
    expect(result.steps[0].toolName).toBe("getOpportunities");
    expect(result.reply.length).toBeGreaterThan(80);
  });

  it("routes a buyer question to the buyer tool", async () => {
    const result = await runAssistant([{ role: "user", content: "Which active buyers want a pool?" }], ID.jamie);
    expect(result.steps.map((s) => s.toolName)).toContain("getBuyers");
  });

  it("records the turn in the audit trail", async () => {
    const store = await getStore();
    await runAssistant([{ role: "user", content: "What is due on my open transactions?" }], ID.jamie);
    const run = (await store.listAIRuns()).find((r) => r.workflow === "assistant");
    expect(run).toBeDefined();
    expect(run!.promptVersion).toMatch(/^assistant@/);
  });

  it("refuses an empty conversation rather than inventing a question", async () => {
    await expect(runAssistant([], ID.jamie)).rejects.toThrow();
  });
});
