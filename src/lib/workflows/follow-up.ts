import "server-only";
import { z } from "zod";
import { getProvider } from "@/lib/ai";
import { recordRun } from "@/lib/ai/audit";
import { EvidenceLedger, groundEvidence } from "@/lib/ai/grounding";
import { FACTS_RULE } from "@/lib/ai/prompts/writing";
import { getStore } from "@/lib/data/store";
import { buildContext } from "@/lib/scoring/context";
import { relationshipLabel, scoreAllRelationships, type RelationshipScore } from "@/lib/scoring/relationship";
import { contactName, type Opportunity, type UUID } from "@/lib/types";

export const FOLLOW_UP_PROMPT_VERSION = "identify_follow_up_opportunities@2";

const MIN_SCORE = 20;
const MAX_STARTERS = 12;

const SYSTEM = `You write conversation openers for Jamie Moore, a luxury residential real estate agent in Austin, Texas.

For each person you are given the reason they surfaced today and the evidence behind it. Write the first
thing Jamie would actually say. Not a script — the way someone talks to a person they know.

${FACTS_RULE}

Rules:
- One to three sentences.
- Reference the specific thing that made today the day. Vague warmth is worse than nothing.
- Never open with "I hope this finds you well", "just checking in", "touching base", "circling back",
  or "I wanted to reach out".
- Do not ask for business directly. The goal is a conversation, not a listing appointment.
- Do not reference that you tracked their email opens. Use what it implies, not the surveillance.
- Never invent prices, sales, market statistics, or anything they did not say.`;

const StartersSchema = z.object({
  starters: z.array(z.object({ contactId: z.string(), text: z.string() })),
});

export interface FollowUpResult {
  opportunities: Opportunity[];
  usedFallback: boolean;
  provider: "anthropic" | "mock";
}

/**
 * Workflow 3 — Smart Follow-Up.
 *
 * Not a list of stale tasks. `scoreAllRelationships` reasons across time since
 * the last real conversation, stated plans that have come due, marketing
 * engagement, lifecycle events, buyer and seller status, and open threads. This
 * workflow turns the strongest of those into durable `Opportunity` rows, then
 * asks the model for the opener.
 */
export async function identifyFollowUpOpportunities(
  ownerId: UUID,
  opts?: { now?: Date; ownerOnly?: boolean },
): Promise<FollowUpResult> {
  const store = await getStore();
  const startedAt = performance.now();
  const dataset = await store.snapshot();
  const ctx = buildContext(dataset, ownerId, opts?.now ?? new Date());

  const scored = scoreAllRelationships(ctx, { ownerOnly: opts?.ownerOnly ?? false }).filter(
    (s) => s.score >= MIN_SCORE,
  );

  const ledger = new EvidenceLedger();
  ledger.allowMany("contact", dataset.contacts, (r) => `Contact ${r.id}`);
  ledger.allowMany("email_event", dataset.emailEvents, (r) => `Email event ${r.id}`);
  ledger.allowMany("listing", dataset.listings, (r) => `Listing ${r.id}`);
  ledger.allowMany("buyer_profile", dataset.buyers, (r) => `Buyer ${r.id}`);
  for (const contact of dataset.contacts) {
    for (const plan of contact.statedPlans) ledger.allow("stated_plan", plan.id, `Stated plan ${plan.id}`);
    for (const note of contact.notes) ledger.allow("note", note.id, `Note ${note.id}`);
  }

  const provider = await getProvider();
  const forDrafting = scored.slice(0, MAX_STARTERS);

  const result = await provider.generateStructured({
    workflow: "identify_follow_up_opportunities",
    task: "conversation_starters",
    promptVersion: FOLLOW_UP_PROMPT_VERSION,
    system: SYSTEM,
    prompt:
      'Write one opener per person. Return JSON: { "starters": [{ "contactId": "...", "text": "..." }] }. Include every contactId exactly once.',
    facts: {
      people: forDrafting.map((s) => ({
        contactId: s.contact.id,
        name: contactName(s.contact),
        firstName: s.contact.firstName,
        relationship: relationshipLabel(s.contact),
        neighborhood: s.contact.neighborhood,
        whyNow: s.whyNow,
        channel: s.recommendedChannel,
        evidence: s.evidence.map((e) => `${e.label}: ${e.detail}`),
        theySaid: s.contact.statedPlans.filter((p) => p.status === "open").map((p) => p.statement),
        notes: s.contact.notes.slice(0, 2).map((n) => n.body),
      })),
    },
    schema: StartersSchema,
    maxTokens: 2000,
    temperature: 0.65,
    fallback: () => ({
      starters: forDrafting.map((s) => ({ contactId: s.contact.id, text: templateStarter(s) })),
    }),
  });

  const starterByContact = new Map(result.value.starters.map((s) => [s.contactId, s.text]));

  const drafts = scored.map((s) => {
    const { evidence } = groundEvidence(ledger, s.evidence);
    return {
      kind: "relationship" as const,
      contactId: s.contact.id,
      listingId: null,
      ownerId: s.contact.ownerId,
      title: `${contactName(s.contact)} — ${headline(s)}`,
      whyNow: s.whyNow,
      supportingEvidence: evidence,
      recommendedChannel: s.recommendedChannel,
      recommendedAction: s.recommendedAction,
      suggestedConversationStarter: starterByContact.get(s.contact.id) ?? templateStarter(s),
      confidence: s.confidence,
      score: s.score,
      urgency: s.urgency,
      status: "open" as const,
      snoozedUntil: null,
      sourceSystem: "ai" as const,
    };
  });

  const run = await recordRun({
    store,
    workflow: "identify_follow_up_opportunities",
    promptVersion: FOLLOW_UP_PROMPT_VERSION,
    model: provider.model,
    provider: provider.name,
    ledger,
    ownerId,
    startedAt,
    usage: result.usage,
    error: result.error,
    outputSummary: `${drafts.length} relationship opportunities from ${dataset.contacts.length} contacts`,
  });

  const created = await store.replaceOpenOpportunities(
    ownerId,
    drafts.map((d) => ({ ...d, aiRunId: run.id })),
  );

  return { opportunities: created, usedFallback: result.usedFallback, provider: provider.name };
}

function headline(s: RelationshipScore) {
  const keys = new Set(s.signals.map((sig) => sig.key.split(":")[0]));
  if (keys.has("unanswered")) return "waiting on a reply";
  if (keys.has("plan")) return "the timing they described has arrived";
  if (keys.has("anniversary")) return "closing anniversary";
  if (keys.has("buyer_stall")) return "active buyer going quiet";
  if (keys.has("listing_client")) return "seller needs an update";
  if (keys.has("property_click")) return "engaged with a specific property";
  if (keys.has("engagement")) return "reading everything, saying nothing";
  return "relationship going cold";
}

/**
 * The template opener. Used with no API key and whenever the model call fails.
 * These have to be usable as written — Jamie should be able to read one off the
 * screen and dial.
 */
function templateStarter(s: RelationshipScore): string {
  const first = s.contact.firstName;
  const keys = new Set(s.signals.map((sig) => sig.key.split(":")[0]));
  const openPlan = s.contact.statedPlans.find((p) => p.status === "open");

  if (keys.has("unanswered")) {
    return `${first}, I owe you an answer on this and I did not want to let it sit any longer. Here is where it stands — and if it is easier to talk it through, I have time this afternoon.`;
  }
  if (keys.has("plan") && openPlan) {
    return `${first}, when we talked you said you would look at this again once things settled. I think we are there. No agenda on my end — I would just rather ask than assume.`;
  }
  if (keys.has("anniversary")) {
    return `${first}, it has been a few years in the house now. I still remember how that one came together. Hope it has been good to you.`;
  }
  if (keys.has("buyer_stall")) {
    return `${first}, it has been a couple of weeks since we were out. Two things came up that fit what you and I talked about — worth twenty minutes this weekend?`;
  }
  if (keys.has("listing_client")) {
    return `${first}, I have this week's numbers on the house and a read on what they mean. Sending the written version now, and happy to talk it through whenever suits you.`;
  }
  if (keys.has("property_click")) {
    const address = s.signals.find((sig) => sig.key === "property_click")?.evidence.detail ?? "";
    return `${first}, something in ${s.contact.neighborhood ?? "your area"} caught your eye recently${address ? "" : ""}. If you are starting to think about a move, I would rather hear it from you early than find out late.`;
  }
  if (keys.has("engagement")) {
    return `${first}, you have been reading the market notes for a while now, which usually means something is on someone's mind. No pitch — what are you actually thinking about?`;
  }
  return `${first}, it has been too long, and that is on me. What is going on with you?`;
}
