import { daysBetween, formatDate, relativeDays } from "@/lib/utils";
import type { Channel, Contact, Evidence, Urgency } from "@/lib/types";
import { CONTACT_TYPE_LABELS } from "@/lib/types";
import type { WorkContext } from "./context";
import { listingAddress } from "./context";

/**
 * Relationship follow-up scoring.
 *
 * This is deliberately *not* "surface old tasks". It reasons across time since
 * the last real conversation, things the person said they were going to do,
 * marketing engagement, lifecycle events and open threads — and weights them
 * against what kind of relationship it is. An active buyer who has not been
 * called in nine days is a problem; a sphere contact at nine days is not.
 *
 * Every signal it fires produces a piece of `Evidence` pointing at a real
 * record, so the reason on screen is always checkable.
 */

/** How often each kind of relationship should hear from a human, in days. */
const EXPECTED_CADENCE_DAYS: Record<Contact["type"], number> = {
  lead: 2,
  active_buyer: 5,
  active_seller: 6,
  past_client: 90,
  sphere: 120,
  agent: 180,
  vendor: 365,
};

/** How much a lapse in each relationship type is worth at the cap. */
const LAPSE_WEIGHT: Record<Contact["type"], number> = {
  lead: 34,
  active_buyer: 32,
  active_seller: 32,
  past_client: 22,
  sphere: 18,
  agent: 8,
  vendor: 4,
};

export interface RelationshipSignal {
  key: string;
  points: number;
  evidence: Evidence;
  /** A clause that reads naturally in a sentence joined by "and". */
  clause: string;
}

export interface RelationshipScore {
  contact: Contact;
  score: number;
  urgency: Urgency;
  confidence: number;
  signals: RelationshipSignal[];
  whyNow: string;
  recommendedChannel: Channel;
  recommendedAction: string;
  lastMeaningfulInteraction: string;
  evidence: Evidence[];
}

function urgencyFor(score: number): Urgency {
  if (score >= 75) return "critical";
  if (score >= 55) return "high";
  if (score >= 32) return "medium";
  return "low";
}

/**
 * Score one relationship. Returns null when nothing is actually due — silence
 * is the correct answer far more often than a nudge, and a dashboard that cries
 * wolf gets ignored.
 */
export function scoreRelationship(contact: Contact, ctx: WorkContext): RelationshipScore | null {
  if (contact.doNotContact) return null;

  const signals: RelationshipSignal[] = [];
  const now = ctx.now;

  /* --- 1. Time since a real human conversation ------------------------- */
  const cadence = EXPECTED_CADENCE_DAYS[contact.type];
  const sinceContact = contact.lastPersonalContactAt
    ? daysBetween(contact.lastPersonalContactAt, now)
    : 999;
  const overdueRatio = sinceContact / cadence;

  if (overdueRatio >= 1) {
    // Saturates rather than growing without bound: 10x overdue is not 10x worse.
    const weight = LAPSE_WEIGHT[contact.type];
    const points = Math.round(weight * Math.min(1, Math.log2(overdueRatio + 1) / 2.6));
    signals.push({
      key: "lapse",
      points,
      clause:
        sinceContact >= 999
          ? "there is no record of a personal conversation"
          : `there has been no personal contact in ${sinceContact} days`,
      evidence: {
        label: "Last personal contact",
        detail: contact.lastPersonalContactAt
          ? `${contact.lastPersonalContactChannel ?? "contact"} on ${formatDate(contact.lastPersonalContactAt)} (${sinceContact} days ago)`
          : "No personal contact on record",
        recordType: "contact",
        recordId: contact.id,
        occurredAt: contact.lastPersonalContactAt ?? null,
      },
    });
  }

  /* --- 2. Something they said they would do, now due -------------------- */
  for (const plan of contact.statedPlans) {
    if (plan.status !== "open") continue;
    const daysSinceMature = daysBetween(plan.maturesAt, now);
    if (daysSinceMature < 0) continue;
    signals.push({
      key: `plan:${plan.id}`,
      points: Math.min(30, 20 + Math.floor(daysSinceMature / 7)),
      clause: `they told you "${trimPeriod(plan.statement)}" — and that time has arrived`,
      evidence: {
        label: "Stated plan",
        detail: `"${plan.statement}" — said on ${formatDate(plan.statedAt)}`,
        recordType: "stated_plan",
        recordId: plan.id,
        occurredAt: plan.statedAt,
      },
    });
  }

  /* --- 3. Marketing engagement ----------------------------------------- */
  const events = ctx.emailEventsByContactId.get(contact.id) ?? [];
  const recentOpens = events.filter((e) => e.type === "email_open" && daysBetween(e.occurredAt, now) <= 120);
  const propertyClicks = events.filter((e) => e.type === "property_click" && daysBetween(e.occurredAt, now) <= 60);

  if (recentOpens.length >= 3) {
    const newest = recentOpens[0];
    signals.push({
      key: "engagement",
      points: Math.min(22, 8 + recentOpens.length * 3),
      clause: `they have opened the last ${recentOpens.length} market emails`,
      evidence: {
        label: "Email engagement",
        detail: `${recentOpens.length} opens in the last 120 days, most recently ${relativeDays(newest.occurredAt)}${newest.campaignName ? ` (${newest.campaignName})` : ""}`,
        recordType: "email_event",
        recordId: newest.id,
        occurredAt: newest.occurredAt,
      },
    });
  }

  if (propertyClicks.length > 0) {
    const newest = propertyClicks[0];
    const addresses = [...new Set(propertyClicks.map((c) => c.propertyAddress).filter(Boolean))];
    signals.push({
      key: "property_click",
      points: Math.min(20, 9 + propertyClicks.length * 4),
      clause:
        addresses.length === 1
          ? `they clicked through to ${addresses[0]}`
          : `they clicked through to ${propertyClicks.length} properties`,
      evidence: {
        label: "Property interest",
        detail: `${propertyClicks.length} property clicks in 60 days${addresses.length ? `: ${addresses.slice(0, 3).join("; ")}` : ""}`,
        recordType: "email_event",
        recordId: newest.id,
        occurredAt: newest.occurredAt,
      },
    });
  }

  /* --- 4. An inbound message nobody answered ---------------------------- */
  const unanswered = events.filter((e) => e.awaitingReply);
  if (unanswered.length > 0) {
    const oldest = unanswered[unanswered.length - 1];
    const waiting = daysBetween(oldest.occurredAt, now);
    signals.push({
      key: "unanswered",
      points: Math.min(38, 16 + waiting * 4),
      clause: `an email from them has been waiting ${waiting === 0 ? "since today" : `${waiting} days`} for a reply`,
      evidence: {
        label: "Unanswered email",
        detail: `"${oldest.subject ?? "(no subject)"}" received ${relativeDays(oldest.occurredAt)}${oldest.snippet ? ` — ${oldest.snippet}` : ""}`,
        recordType: "email_event",
        recordId: oldest.id,
        occurredAt: oldest.occurredAt,
      },
    });
  }

  /* --- 5. Lifecycle: the home anniversary ------------------------------- */
  const anniversary = contact.anniversaryAt ?? contact.homePurchaseDate;
  if (anniversary) {
    const daysUntil = daysUntilNextAnniversary(anniversary, now);
    if (daysUntil !== null && daysUntil <= 14) {
      const years = yearsSince(anniversary, now) + (daysUntil > 0 ? 1 : 0);
      signals.push({
        key: "anniversary",
        points: 14,
        clause:
          daysUntil === 0
            ? `today is the anniversary of their closing`
            : `the ${ordinal(years)} anniversary of their closing is in ${daysUntil} ${daysUntil === 1 ? "day" : "days"}`,
        evidence: {
          label: "Home anniversary",
          detail: `Closed ${formatDate(anniversary)}`,
          recordType: "contact",
          recordId: contact.id,
          occurredAt: anniversary,
        },
      });
    }
  }

  /* --- 6. Active client with an open listing and a stale conversation --- */
  const sellingListings = ctx.listingsBySellerContactId.get(contact.id) ?? [];
  const liveListing = sellingListings.find((l) => ["active", "price_change", "coming_soon"].includes(l.status));
  if (liveListing && sinceContact >= 5) {
    signals.push({
      key: "listing_client",
      points: 16,
      clause: `their listing at ${listingAddress(ctx, liveListing)} is live and they have not heard from you this week`,
      evidence: {
        label: "Active listing",
        detail: `${listingAddress(ctx, liveListing)} — ${liveListing.showingsThisWeek} showings this week`,
        recordType: "listing",
        recordId: liveListing.id,
        occurredAt: liveListing.lastActivityAt ?? null,
      },
    });
  }

  const buyer = ctx.buyerByContactId.get(contact.id);
  if (buyer?.active && buyer.lastShowingAt && daysBetween(buyer.lastShowingAt, now) >= 7 && sinceContact >= 4) {
    const since = daysBetween(buyer.lastShowingAt, now);
    signals.push({
      key: "buyer_stall",
      points: 18,
      clause: `they are an active buyer who has not been out with you in ${since} days`,
      evidence: {
        label: "Buyer activity",
        detail: `Last showing ${formatDate(buyer.lastShowingAt)}; searching ${buyer.targetLocations.slice(0, 3).join(", ")}`,
        recordType: "buyer_profile",
        recordId: buyer.id,
        occurredAt: buyer.lastShowingAt,
      },
    });
  }

  if (signals.length === 0) return null;

  const raw = signals.reduce((sum, s) => sum + s.points, 0);
  const score = Math.min(100, raw);

  // Confidence reflects how much corroboration there is, not how loud one
  // signal was. One stale timestamp is a guess; four signals agreeing is not.
  const confidence = Math.min(0.95, 0.4 + signals.length * 0.13);

  return {
    contact,
    score,
    urgency: urgencyFor(score),
    confidence: Number(confidence.toFixed(2)),
    signals,
    whyNow: buildWhyNow(signals),
    recommendedChannel: recommendChannel(contact, signals),
    recommendedAction: recommendAction(contact, signals),
    lastMeaningfulInteraction: contact.lastPersonalContactAt
      ? `${contact.lastPersonalContactChannel ?? "Contact"} · ${relativeDays(contact.lastPersonalContactAt)}`
      : "No personal contact on record",
    evidence: signals.map((s) => s.evidence),
  };
}

export function scoreAllRelationships(ctx: WorkContext, opts?: { ownerOnly?: boolean }): RelationshipScore[] {
  return ctx.dataset.contacts
    .filter((c) => (opts?.ownerOnly ? c.ownerId === ctx.ownerId : true))
    .map((c) => scoreRelationship(c, ctx))
    .filter((s): s is RelationshipScore => s !== null)
    .sort((a, b) => b.score - a.score);
}

/* ------------------------------------------------------------------ prose */

function buildWhyNow(signals: RelationshipSignal[]) {
  const ordered = [...signals].sort((a, b) => b.points - a.points).slice(0, 3);
  const clauses = ordered.map((s) => s.clause);
  const sentence =
    clauses.length === 1
      ? clauses[0]
      : `${clauses.slice(0, -1).join(", ")} and ${clauses[clauses.length - 1]}`;
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

function recommendChannel(contact: Contact, signals: RelationshipSignal[]): Channel {
  if (signals.some((s) => s.key === "unanswered")) return "email";
  if (signals.some((s) => s.key === "anniversary")) return "handwritten_note";
  if (contact.type === "active_buyer" || contact.type === "active_seller" || contact.type === "lead") return "call";
  if (signals.some((s) => s.key === "engagement" || s.key === "property_click")) return "call";
  return contact.phone ? "call" : "email";
}

function recommendAction(contact: Contact, signals: RelationshipSignal[]): string {
  const name = contact.firstName;
  const keys = new Set(signals.map((s) => s.key));
  if (keys.has("unanswered")) return `Reply to ${name} today — they asked a direct question and are waiting.`;
  if (keys.has("plan")) {
    const plan = signals.find((s) => s.key.startsWith("plan:"));
    if (plan) return `Call ${name} about the move they told you they would revisit.`;
  }
  if ([...keys].some((k) => k.startsWith("plan:"))) return `Call ${name} about the plan they described.`;
  if (keys.has("buyer_stall")) return `Call ${name} with two or three specific properties, not a general check-in.`;
  if (keys.has("listing_client")) return `Send ${name} this week's listing update before they ask for it.`;
  if (keys.has("anniversary")) return `Send ${name} a handwritten note for the anniversary.`;
  if (keys.has("property_click") || keys.has("engagement")) {
    return `Call ${name} — the engagement is there, the conversation is not.`;
  }
  return `Reach out to ${name} personally.`;
}

/* ------------------------------------------------------------- date maths */

function daysUntilNextAnniversary(iso: string, now: Date): number | null {
  const source = new Date(iso);
  if (Number.isNaN(source.getTime())) return null;
  const thisYear = new Date(Date.UTC(now.getUTCFullYear(), source.getUTCMonth(), source.getUTCDate()));
  const target =
    thisYear.getTime() >= startOfUTCDay(now)
      ? thisYear
      : new Date(Date.UTC(now.getUTCFullYear() + 1, source.getUTCMonth(), source.getUTCDate()));
  return Math.round((target.getTime() - startOfUTCDay(now)) / 86_400_000);
}

function startOfUTCDay(d: Date) {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function yearsSince(iso: string, now: Date) {
  return Math.max(0, now.getUTCFullYear() - new Date(iso).getUTCFullYear());
}

function ordinal(n: number) {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

/**
 * Stated plans are quoted rather than paraphrased into the sentence. Splicing
 * them in only reads correctly when the statement happens to start with a verb,
 * and a misquoted client note is worse than a slightly stiff sentence.
 */
function trimPeriod(statement: string) {
  return statement.trim().replace(/\.$/, "");
}

export function relationshipLabel(contact: Contact) {
  return CONTACT_TYPE_LABELS[contact.type];
}
