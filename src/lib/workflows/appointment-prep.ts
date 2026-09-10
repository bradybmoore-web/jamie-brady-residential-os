import "server-only";
import { z } from "zod";
import { getProvider } from "@/lib/ai";
import { recordRun } from "@/lib/ai/audit";
import { EvidenceLedger, groundEvidence } from "@/lib/ai/grounding";
import { FACTS_RULE } from "@/lib/ai/prompts/writing";
import { getStore } from "@/lib/data/store";
import { formatCurrency, formatDate, formatTime, relativeDays } from "@/lib/utils";
import {
  APPOINTMENT_TYPE_LABELS,
  CONTACT_TYPE_LABELS,
  contactName,
  type AppointmentPrep,
  type Contact,
  type Evidence,
  type UUID,
} from "@/lib/types";

export const PREP_PROMPT_VERSION = "appointment_prep@2";

const SYSTEM = `You prepare Jamie Moore for a real estate appointment. She has fifteen minutes in the car.

${FACTS_RULE}

Produce two things:

1. talkingPoints — three to six things worth raising, in the order she should raise them. Specific to these
   people and this property. Not generic agent advice. If the strongest point is uncomfortable — a price
   conversation, an expectation that needs resetting — put it first, because that is the one that will get
   avoided otherwise.

2. outstandingQuestions — the two to four things Jamie does not know and should ask. Questions whose answers
   would change what she does next. Not questions she already has the answer to in the facts.

Never invent a showing, an offer, a price, a competing listing, or something the client said. If a fact is
not in the facts block, it did not happen.`;

const PrepSchema = z.object({
  talkingPoints: z.array(z.string()).min(1).max(8),
  outstandingQuestions: z.array(z.string()).min(1).max(6),
});

export interface AppointmentPrepResult {
  prep: AppointmentPrep;
  usedFallback: boolean;
  provider: "anthropic" | "mock";
}

/**
 * The "Prepare Me" brief.
 *
 * Assembles who they are, what has been said, what they want, and what is
 * outstanding, from the records — then asks the model for the two things that
 * genuinely require judgement: what to raise, and what to ask.
 */
export async function prepareAppointment(
  calendarEventId: UUID,
  ownerId: UUID,
): Promise<AppointmentPrepResult> {
  const store = await getStore();
  const event = await store.getCalendarEvent(calendarEventId);
  if (!event) throw new Error(`Appointment ${calendarEventId} not found`);

  const startedAt = performance.now();
  const [allContacts, emailEvents, buyers, listings, properties, transactions] = await Promise.all([
    store.listContacts(),
    store.listEmailEvents(),
    store.listBuyers(),
    store.listListings(),
    store.listProperties(),
    store.listTransactions(),
  ]);

  const contacts = allContacts.filter((c) => event.contactIds.includes(c.id));
  const listing = event.listingId ? listings.find((l) => l.id === event.listingId) : undefined;
  const property = event.propertyId
    ? properties.find((p) => p.id === event.propertyId)
    : listing
      ? properties.find((p) => p.id === listing.propertyId)
      : undefined;
  const relevantTransactions = transactions.filter((t) =>
    t.clientContactIds.some((id) => event.contactIds.includes(id)),
  );

  /* --- Assemble the record-derived sections ----------------------------- */
  const contactSummary = buildContactSummary(event.title, event.type, contacts, event.notes);

  const recentCommunication = contacts.flatMap((c) =>
    emailEvents
      .filter((e) => e.contactId === c.id)
      .slice(0, 4)
      .map(
        (e) =>
          `${formatDate(e.occurredAt)} — ${c.firstName}: ${describeEmailEvent(e.type)}${e.subject ? ` "${e.subject}"` : ""}${e.snippet ? ` — ${e.snippet}` : ""}`,
      ),
  );

  const knownGoals = contacts.flatMap((c) => [
    ...c.statedPlans.filter((p) => p.status === "open").map((p) => `${c.firstName}: ${p.statement}`),
    ...buyers
      .filter((b) => b.contactId === c.id && b.active)
      .flatMap((b) => [
        `${c.firstName} is looking at ${formatCurrency(b.priceMin)}–${formatCurrency(b.priceMax)} in ${b.targetLocations.join(", ")}.`,
        b.mustHaves.length ? `Must have: ${b.mustHaves.join("; ")}.` : "",
        b.dealBreakers.length ? `Deal breakers: ${b.dealBreakers.join("; ")}.` : "",
        b.timeline ? `Timeline: ${b.timeline}.` : "",
      ]),
  ]).filter(Boolean);

  const priorNotes = contacts.flatMap((c) =>
    c.notes.slice(0, 3).map((n) => `${formatDate(n.createdAt)} — ${c.firstName}: ${n.body}`),
  );

  /* --- Evidence --------------------------------------------------------- */
  const ledger = new EvidenceLedger().allow("calendar_event", event.id, `Appointment ${event.title}`);
  ledger.allowMany("contact", contacts, (r) => `Contact ${r.id}`);
  ledger.allowMany("email_event", emailEvents, (r) => `Email event ${r.id}`);
  if (listing) ledger.allow("listing", listing.id, `Listing ${listing.id}`);
  for (const c of contacts) {
    for (const n of c.notes) ledger.allow("note", n.id, `Note ${n.id}`);
    for (const p of c.statedPlans) ledger.allow("stated_plan", p.id, `Plan ${p.id}`);
  }
  for (const b of buyers) if (contacts.some((c) => c.id === b.contactId)) ledger.allow("buyer_profile", b.id, `Buyer ${b.id}`);
  for (const t of relevantTransactions) ledger.allow("transaction", t.id, `Transaction ${t.id}`);

  const rawEvidence: Evidence[] = [
    {
      label: "Appointment",
      detail: `${APPOINTMENT_TYPE_LABELS[event.type]} at ${formatTime(event.startsAt)}${event.location ? `, ${event.location}` : ""}`,
      recordType: "calendar_event",
      recordId: event.id,
      occurredAt: event.startsAt,
    },
    ...contacts.map((c) => ({
      label: contactName(c),
      detail: `${CONTACT_TYPE_LABELS[c.type]} · last personal contact ${relativeDays(c.lastPersonalContactAt)}`,
      recordType: "contact" as const,
      recordId: c.id,
      occurredAt: c.lastPersonalContactAt ?? null,
    })),
    ...contacts.flatMap((c) =>
      c.notes.slice(0, 2).map((n) => ({
        label: `Note on ${c.firstName}`,
        detail: n.body,
        recordType: "note" as const,
        recordId: n.id,
        occurredAt: n.createdAt,
      })),
    ),
  ];

  if (listing && property) {
    rawEvidence.push({
      label: "Related listing",
      detail: `${property.address} — ${listing.status.replace(/_/g, " ")} at ${formatCurrency(listing.listPrice)}`,
      recordType: "listing",
      recordId: listing.id,
      occurredAt: listing.lastActivityAt ?? null,
    });
  }
  for (const t of relevantTransactions) {
    const next = t.milestones.filter((m) => !m.complete).sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0];
    rawEvidence.push({
      label: "Open transaction",
      detail: `${properties.find((p) => p.id === t.propertyId)?.address ?? "Property"} — ${t.status.replace(/_/g, " ")}${next ? `, ${next.label} due ${formatDate(next.dueAt)}` : ""}`,
      recordType: "transaction",
      recordId: t.id,
      occurredAt: next?.dueAt ?? t.contractDate,
    });
  }

  const { evidence } = groundEvidence(ledger, rawEvidence);

  /* --- Judgement layer -------------------------------------------------- */
  const provider = await getProvider();
  const result = await provider.generateStructured({
    workflow: "appointment_prep",
    task: "talking_points",
    promptVersion: PREP_PROMPT_VERSION,
    system: SYSTEM,
    prompt:
      'Prepare Jamie for this appointment. Return JSON: { "talkingPoints": ["..."], "outstandingQuestions": ["..."] }.',
    facts: {
      appointment: {
        title: event.title,
        type: APPOINTMENT_TYPE_LABELS[event.type],
        startsAt: event.startsAt,
        location: event.location,
        notes: event.notes,
      },
      people: contacts.map((c) => ({
        name: contactName(c),
        relationship: CONTACT_TYPE_LABELS[c.type],
        lastPersonalContact: c.lastPersonalContactAt,
        neighborhood: c.neighborhood,
        notes: c.notes.map((n) => n.body),
        statedPlans: c.statedPlans.filter((p) => p.status === "open").map((p) => p.statement),
      })),
      buyerProfiles: buyers
        .filter((b) => contacts.some((c) => c.id === b.contactId))
        .map((b) => ({
          priceRange: [b.priceMin, b.priceMax],
          targetLocations: b.targetLocations,
          mustHaves: b.mustHaves,
          dealBreakers: b.dealBreakers,
          niceToHaves: b.niceToHaves,
          emotionalReactions: b.emotionalReactions,
          timeline: b.timeline,
          preApproved: b.preApproved,
        })),
      listing: listing && property
        ? {
            address: property.address,
            status: listing.status,
            listPrice: listing.listPrice,
            originalListPrice: listing.originalListPrice,
            showingsThisWeek: listing.showingsThisWeek,
            totalShowings: listing.totalShowings,
            positioning: listing.positioning,
            writingNotes: listing.writingNotes,
            features: listing.majorFeatures,
          }
        : null,
      openTransactions: relevantTransactions.map((t) => ({
        status: t.status,
        contractPrice: t.contractPrice,
        closeDate: t.closeDate,
        nextMilestone: t.milestones.filter((m) => !m.complete)[0] ?? null,
      })),
      recentCommunication,
      priorNotes,
    },
    schema: PrepSchema,
    maxTokens: 1200,
    temperature: 0.5,
    fallback: () => fallbackPrep(event.type, contacts, knownGoals, relevantTransactions.length > 0, listing, property),
  });

  const run = await recordRun({
    store,
    workflow: "appointment_prep",
    promptVersion: PREP_PROMPT_VERSION,
    model: provider.model,
    provider: provider.name,
    ledger,
    ownerId,
    startedAt,
    usage: result.usage,
    error: result.error,
    outputSummary: `Prep for "${event.title}" — ${result.value.talkingPoints.length} talking points`,
  });

  const prep = await store.saveAppointmentPrep({
    calendarEventId: event.id,
    ownerId,
    contactSummary,
    recentCommunication,
    knownGoals,
    priorNotes,
    relatedListingId: listing?.id ?? null,
    relatedPropertyId: property?.id ?? null,
    outstandingQuestions: result.value.outstandingQuestions,
    talkingPoints: result.value.talkingPoints,
    evidence,
    aiRunId: run.id,
    sourceSystem: "ai",
  });

  await store.updateCalendarEvent(event.id, { prepStatus: "prepared", prepBriefId: prep.id });

  return { prep, usedFallback: result.usedFallback, provider: provider.name };
}

/* ---------------------------------------------------------------- helpers */

function buildContactSummary(
  title: string,
  type: keyof typeof APPOINTMENT_TYPE_LABELS,
  contacts: Contact[],
  notes: string | null | undefined,
) {
  if (contacts.length === 0) {
    return `${APPOINTMENT_TYPE_LABELS[type]}: ${title}.${notes ? ` ${notes}` : ""} No contact record is linked to this appointment yet.`;
  }
  const people = contacts
    .map(
      (c) =>
        `${contactName(c)} (${CONTACT_TYPE_LABELS[c.type]}${c.neighborhood ? `, ${c.neighborhood}` : ""}) — last spoke ${relativeDays(c.lastPersonalContactAt)}`,
    )
    .join("; ");
  return `${APPOINTMENT_TYPE_LABELS[type]} with ${people}.${notes ? ` ${notes}` : ""}`;
}

function describeEmailEvent(type: string) {
  switch (type) {
    case "email_received":
      return "sent you an email";
    case "email_sent":
      return "you emailed them";
    case "email_open":
      return "opened a market email";
    case "email_click":
      return "clicked a link in a market email";
    case "property_click":
      return "clicked through to a property";
    case "campaign_response":
      return "replied to a campaign";
    default:
      return type;
  }
}

function fallbackPrep(
  type: keyof typeof APPOINTMENT_TYPE_LABELS,
  contacts: Contact[],
  knownGoals: string[],
  hasTransaction: boolean,
  listing?: { listPrice: number; originalListPrice: number; showingsThisWeek: number; positioning: string },
  property?: { address: string },
) {
  const first = contacts[0]?.firstName ?? "them";
  const talkingPoints: string[] = [];
  const outstandingQuestions: string[] = [];

  if (type === "listing_appointment") {
    talkingPoints.push(
      "Open by asking what is driving the move and by when — everything else follows from the answer.",
      "Walk the house before talking about price. What you see changes what the number should be.",
      "Set the expectation now that the first two weeks generate the most showings, so the launch price matters more than the list price.",
    );
    outstandingQuestions.push(
      "What is the actual deadline, and what happens if it slips?",
      "Have they spoken to another agent, and what were they told?",
      "What do they owe on the house, and is there a number below which this does not work?",
    );
  } else if (type === "buyer_consult") {
    talkingPoints.push(
      `Confirm what ${first} actually needs versus what they would like — the list usually shrinks in person.`,
      "Be direct about what their budget buys right now in the areas they named.",
      "Agree how you will make a decision when the right house appears, before it appears.",
    );
    outstandingQuestions.push(
      "What would make them walk away from a house they otherwise loved?",
      "Who else is involved in the decision?",
      "Is the financing actually in place, or just discussed?",
    );
  } else if (type === "showing") {
    talkingPoints.push(
      "Let them react to the house before offering an opinion.",
      `Point out the one or two things about ${property?.address ?? "this house"} that do not photograph — the street, the light, the yard.`,
      "Ask for a decision on whether it stays on the list before you leave the driveway.",
    );
    outstandingQuestions.push(
      "How does this compare with the best thing they have seen so far?",
      "If the price were right, is this a house they would actually buy?",
    );
  } else if (type === "closing" || hasTransaction) {
    talkingPoints.push(
      "Confirm every outstanding milestone and who is responsible for each.",
      "Flag anything that could move the date before it moves on its own.",
    );
    outstandingQuestions.push("Is there anything they have heard from the lender that you have not?");
  } else {
    talkingPoints.push(
      `Start with what has changed for ${first} since you last spoke.`,
      "Bring one specific piece of market information relevant to their situation.",
    );
    outstandingQuestions.push("What is the next thing they are trying to decide?");
  }

  if (listing) {
    if (listing.listPrice < listing.originalListPrice) {
      talkingPoints.unshift(
        "The price has already moved once. Be ready with what the market has said since, and what you would do next.",
      );
    }
    if (listing.showingsThisWeek === 0) {
      talkingPoints.unshift("No showings this week. Lead with that rather than letting them ask.");
    }
  }

  if (knownGoals.length > 0) {
    talkingPoints.push(`Reference what they told you before: ${knownGoals[0]}`);
  }

  return { talkingPoints: talkingPoints.slice(0, 6), outstandingQuestions: outstandingQuestions.slice(0, 4) };
}
