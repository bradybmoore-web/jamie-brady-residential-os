import "server-only";
import { z } from "zod";
import { getProvider } from "@/lib/ai";
import { recordRun } from "@/lib/ai/audit";
import { EvidenceLedger, groundEvidence } from "@/lib/ai/grounding";
import { FACTS_RULE } from "@/lib/ai/prompts/writing";
import { getStore } from "@/lib/data/store";
import { buildContext, listingAddress } from "@/lib/scoring/context";
import { buildListingActions, buildMetrics, buildPriorities, listingsNeedingSellerUpdate, type PriorityCandidate } from "@/lib/scoring/priorities";
import { isSameLocalDay, localDayKey } from "@/lib/utils";
import type { DailyBrief, Evidence, Priority, UUID } from "@/lib/types";

export const DAILY_PROMPT_VERSION = "daily_command_center@3";

const MAX_PRIORITIES = 8;
const MAX_MESSAGES_DRAFTED = 5;

const SYSTEM = `You write the morning briefing for Jamie Moore, a luxury residential real estate agent in Austin, Texas.

You are given a list of people who need her attention today. The list, the ranking, the urgency and the
evidence have already been determined. Your job is only to write, for each person, the opening line
Jamie could actually say when she picks up the phone or starts the email.

${FACTS_RULE}

For each person write one or two sentences that:
- reference the specific thing that makes today the right day, using the evidence given,
- sound like a person who knows them, not a script,
- give them a concrete reason to talk now,
- never open with "I hope this finds you well", "just checking in", "touching base", or "reaching out".

Do not invent showings, offers, prices, market statistics, or conversations that are not in the facts.
If the evidence is thin, write something short and honest rather than something impressive.`;

const MessagesSchema = z.object({
  messages: z.array(
    z.object({
      key: z.string(),
      suggestedMessage: z.string(),
    }),
  ),
});

export interface DailyCommandCenterResult {
  brief: DailyBrief;
  /** True when the language came from templates rather than a model. */
  usedFallback: boolean;
  provider: "anthropic" | "mock";
}

/**
 * Workflow 1 — the Daily Command Center.
 *
 * Structure: gather everything Jamie owns, rank it deterministically, ground
 * every claim against the records that produced it, then ask the model for one
 * thing only — the opening line. The brief is cached per day so opening the
 * dashboard repeatedly does not re-run the model.
 */
export async function dailyCommandCenter(
  ownerId: UUID,
  opts?: { force?: boolean; now?: Date },
): Promise<DailyCommandCenterResult> {
  const store = await getStore();
  const now = opts?.now ?? new Date();
  const date = localDayKey(now);

  if (!opts?.force) {
    const cached = await store.getDailyBrief(date, ownerId);
    if (cached) {
      return { brief: cached, usedFallback: false, provider: "mock" };
    }
  }

  const startedAt = performance.now();
  const dataset = await store.snapshot();
  const ctx = buildContext(dataset, ownerId, now);

  /* --- Deterministic layer --------------------------------------------- */
  const candidates = buildPriorities(ctx, { ownerOnly: true }).slice(0, MAX_PRIORITIES);
  const metrics = buildMetrics(ctx, { ownerOnly: true });
  const listingActions = buildListingActions(ctx, { ownerOnly: true });
  const appointments = dataset.calendarEvents
    .filter((e) => e.ownerId === ownerId && isSameLocalDay(e.startsAt, now))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const openLeads = dataset.leads
    .filter((l) => l.assignedTo === ownerId && ["new", "attempted_contact"].includes(l.stage))
    .sort((a, b) => b.score - a.score);
  const sellerUpdateListings = listingsNeedingSellerUpdate(ctx, true);

  /* --- Evidence ledger: exactly what this run was allowed to see -------- */
  const ledger = new EvidenceLedger();
  ledger.allowMany("contact", dataset.contacts, (r) => `Contact ${r.id}`);
  ledger.allowMany("lead", dataset.leads, (r) => `Lead ${r.id}`);
  ledger.allowMany("listing", dataset.listings, (r) => `Listing ${r.id}`);
  ledger.allowMany("task", dataset.tasks, (r) => `Task ${r.id}`);
  ledger.allowMany("email_event", dataset.emailEvents, (r) => `Email event ${r.id}`);
  ledger.allowMany("calendar_event", dataset.calendarEvents, (r) => `Calendar event ${r.id}`);
  ledger.allowMany("transaction", dataset.transactions, (r) => `Transaction ${r.id}`);
  ledger.allowMany("buyer_profile", dataset.buyers, (r) => `Buyer ${r.id}`);
  ledger.allowMany("showing_feedback", dataset.showingFeedback, (r) => `Showing feedback ${r.id}`);
  for (const contact of dataset.contacts) {
    for (const plan of contact.statedPlans) ledger.allow("stated_plan", plan.id, `Stated plan ${plan.id}`);
    for (const note of contact.notes) ledger.allow("note", note.id, `Note ${note.id}`);
  }

  const warnings: string[] = [];

  /* --- Language layer --------------------------------------------------- */
  const provider = await getProvider();
  const drafted = candidates.slice(0, MAX_MESSAGES_DRAFTED);
  const facts = {
    agent: "Jamie Moore",
    date,
    people: drafted.map((c) => ({
      key: c.key,
      name: c.personName,
      relationship: c.relationship,
      whyNow: c.reason,
      recommendedAction: c.recommendedAction,
      channel: c.recommendedChannel,
      lastMeaningfulInteraction: c.lastMeaningfulInteraction,
      evidence: c.evidence.map((e) => `${e.label}: ${e.detail}`),
      context: c.messageContext,
    })),
  };

  const result = await provider.generateStructured({
    workflow: "daily_command_center",
    task: "priority_openers",
    promptVersion: DAILY_PROMPT_VERSION,
    system: SYSTEM,
    prompt: `Write the opening line for each person below. Return JSON: { "messages": [{ "key": "...", "suggestedMessage": "..." }] }. Include every key exactly once.`,
    facts,
    schema: MessagesSchema,
    maxTokens: 1600,
    temperature: 0.6,
    fallback: () => ({
      messages: drafted.map((c) => ({ key: c.key, suggestedMessage: templateMessage(c) })),
    }),
  });

  if (result.error) warnings.push(`AI drafting fell back to templates: ${result.error}`);

  const messageByKey = new Map(result.value.messages.map((m) => [m.key, m.suggestedMessage]));

  const priorities: Priority[] = candidates.map((candidate) => {
    const { evidence, droppedCount } = groundEvidence(ledger, candidate.evidence);
    if (droppedCount > 0) {
      warnings.push(`${droppedCount} unverifiable reference(s) were removed from "${candidate.title}".`);
    }
    return {
      id: candidate.key,
      title: candidate.title,
      personId: candidate.personId ?? null,
      personName: candidate.personName ?? null,
      relationship: candidate.relationship ?? null,
      reason: candidate.reason,
      urgency: candidate.urgency,
      score: candidate.score,
      evidence,
      recommendedAction: candidate.recommendedAction,
      suggestedMessage: messageByKey.get(candidate.key) ?? templateMessage(candidate),
      recommendedChannel: candidate.recommendedChannel,
      lastMeaningfulInteraction: candidate.lastMeaningfulInteraction ?? null,
      sourceReferences: ledger.toSourceReferences(evidence),
    };
  });

  /* --- Warnings Jamie should actually see -------------------------------- */
  for (const listing of sellerUpdateListings) {
    if (listing.showingsThisWeek === 0 && listing.status === "active") {
      warnings.push(`${listingAddress(ctx, listing)} had no showings this week.`);
    }
  }
  const staleAppointments = appointments.filter((e) => e.prepStatus === "not_started" && e.type !== "internal");
  if (staleAppointments.length > 0) {
    warnings.push(
      `${staleAppointments.length} of today's ${appointments.length} appointments have no preparation yet.`,
    );
  }
  if (provider.name === "mock") {
    warnings.push("No Anthropic key is configured. Suggested messages are templates, not model output.");
  }

  const run = await recordRun({
    store,
    workflow: "daily_command_center",
    promptVersion: DAILY_PROMPT_VERSION,
    model: provider.model,
    provider: provider.name,
    ledger,
    ownerId,
    startedAt,
    usage: result.usage,
    error: result.error,
    outputSummary: `${priorities.length} priorities, ${appointments.length} appointments, ${listingActions.length} listing actions`,
  });

  const brief = await store.saveDailyBrief({
    date,
    ownerId,
    topPriorities: priorities.slice(0, 3),
    peopleNeedingAttention: priorities,
    appointments: appointments.map((a) => a.id),
    leads: openLeads.map((l) => l.id),
    listingActions,
    sellerUpdates: dataset.sellerUpdates
      .filter((u) => u.status === "needs_review" || u.status === "draft")
      .map((u) => u.id),
    opportunities: dataset.opportunities.filter((o) => o.status === "open" && o.ownerId === ownerId).map((o) => o.id),
    warnings: [...new Set(warnings)],
    metrics,
    aiRunId: run.id,
    sourceSystem: "ai",
  });

  return { brief, usedFallback: result.usedFallback, provider: provider.name };
}

/**
 * The deterministic version of the opening line.
 *
 * This is what runs with no API key, and what the product falls back to if the
 * model call fails. It has to be good enough to ship on its own.
 */
function templateMessage(candidate: PriorityCandidate): string {
  const ctx = candidate.messageContext as Record<string, unknown>;
  const first = String(ctx.firstName ?? String(candidate.personName ?? "").split(" ")[0] ?? "there");

  switch (ctx.kind) {
    case "lead": {
      const area = ctx.desiredArea ? ` in ${ctx.desiredArea}` : "";
      const timeline = ctx.timeline ? ` You mentioned ${String(ctx.timeline).toLowerCase()}.` : "";
      // A seller's address is their own house; a buyer's is one they asked about.
      const subject = ctx.propertyAddress
        ? ctx.type === "seller"
          ? `your house on ${streetOf(String(ctx.propertyAddress))}`
          : String(ctx.propertyAddress)
        : `a move${area}`;
      return `Hi ${first} — Jamie Moore. You reached out about ${subject}.${timeline} I have a couple of specific things worth telling you before you go any further. Do you have ten minutes today?`;
    }
    case "transaction":
      return `${first}, quick one on ${ctx.address ?? "the contract"} — ${String(ctx.milestone ?? "the next milestone").toLowerCase()} is the item in front of us. Here is exactly where it stands and what I need from you.`;
    case "relationship": {
      const signals = Array.isArray(ctx.signals) ? (ctx.signals as string[]) : [];
      const plans = Array.isArray(ctx.statedPlans) ? (ctx.statedPlans as string[]) : [];
      if (plans.length > 0) {
        return `${first}, you told me you would take another look at this once things settled down. That time has come around, so I wanted to call rather than send you another email. Where is your head on it now?`;
      }
      if (signals.some((s) => s.includes("waiting"))) {
        return `${first} — you asked me a question and I owe you an answer. Here it is, and then let's find fifteen minutes to talk properly.`;
      }
      if (signals.some((s) => s.includes("clicked") || s.includes("opened"))) {
        return `${first}, you have been reading the market notes, which usually means someone is thinking about something. No pitch — I would just rather hear it from you than guess.`;
      }
      return `${first}, it has been too long and that is on me. I have been watching ${ctx.neighborhood ? String(ctx.neighborhood) : "your area"} closely this year and there are one or two things worth telling you about.`;
    }
    case "task":
      return candidate.personName
        ? `${first}, following up on ${String(ctx.task ?? "this").toLowerCase()}.`
        : String(ctx.task ?? candidate.title);
    default:
      return candidate.recommendedAction;
  }
}

/** "1912 Sunfish Cove, Cedar Park, TX 78613" -> "Sunfish Cove". */
function streetOf(address: string) {
  return address.split(",")[0].replace(/^\d+\s+/, "").trim() || address;
}

/** Exposed so the Today page can render evidence without re-deriving it. */
export function evidenceSummary(evidence: Evidence[]) {
  return evidence.map((e) => `${e.label}: ${e.detail}`);
}
