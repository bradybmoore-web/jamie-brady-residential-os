import { daysBetween, formatDate, isSameLocalDay, relativeDays } from "@/lib/utils";
import {
  URGENCY_RANK,
  contactName,
  leadName,
  type Channel,
  type DailyMetrics,
  type Evidence,
  type Lead,
  type ListingAction,
  type Listing,
  type Task,
  type Urgency,
} from "@/lib/types";
import type { WorkContext } from "./context";
import { listingAddress } from "./context";
import { scoreAllRelationships, relationshipLabel } from "./relationship";

/**
 * "People Who Need You" and the rest of the Today page.
 *
 * Priorities are assembled deterministically from five streams — overdue work,
 * leads, open threads, transaction deadlines and relationship decay — then
 * ranked against each other on a single scale. The model never decides who is
 * on this list; it only helps phrase the message once the list exists.
 */

export interface PriorityCandidate {
  key: string;
  title: string;
  personId?: string | null;
  personName?: string | null;
  relationship?: string | null;
  reason: string;
  urgency: Urgency;
  score: number;
  evidence: Evidence[];
  recommendedAction: string;
  recommendedChannel: Channel;
  lastMeaningfulInteraction?: string | null;
  /** Context handed to the model when it drafts the suggested opener. */
  messageContext: Record<string, unknown>;
  leadId?: string | null;
  listingId?: string | null;
  taskId?: string | null;
}

const OPEN_LEAD_STAGES = new Set(["new", "attempted_contact", "connected", "nurture", "appointment_set"]);

export function buildPriorities(ctx: WorkContext, opts?: { ownerOnly?: boolean }): PriorityCandidate[] {
  const ownerOnly = opts?.ownerOnly ?? true;
  const candidates: PriorityCandidate[] = [];
  const now = ctx.now;

  /* --- New and stalling leads ------------------------------------------ */
  for (const lead of ctx.dataset.leads) {
    if (ownerOnly && lead.assignedTo !== ctx.ownerId) continue;
    if (!OPEN_LEAD_STAGES.has(lead.stage)) continue;

    const ageHours = (now.getTime() - new Date(lead.inquiredAt).getTime()) / 3_600_000;
    const overdueDays = lead.followUpDueAt ? daysBetween(lead.followUpDueAt, now) : -999;
    const untouched = lead.attemptCount === 0;

    // Speed to lead is the whole game for a brand new inquiry.
    let score = Math.round(lead.score * 0.45);
    let reason: string;
    let urgency: Urgency;

    if (untouched && ageHours <= 48) {
      score += Math.round(34 - Math.min(30, ageHours / 2));
      urgency = lead.score >= 80 ? "critical" : "high";
      reason = `New ${lead.type === "unknown" ? "" : `${lead.type} `}inquiry ${ageHours < 1 ? "in the last hour" : `${Math.round(ageHours)} hours ago`}, not yet contacted.`;
    } else if (overdueDays >= 0) {
      score += Math.min(30, 14 + overdueDays * 6);
      urgency = lead.score >= 80 ? "critical" : overdueDays >= 2 ? "high" : "medium";
      reason = `Follow-up was due ${overdueDays === 0 ? "today" : `${overdueDays} days ago`} after ${lead.attemptCount} ${lead.attemptCount === 1 ? "attempt" : "attempts"}.`;
    } else if (untouched) {
      score += 12;
      urgency = "medium";
      reason = `Inquired ${relativeDays(lead.inquiredAt)} and has never been contacted.`;
    } else {
      continue;
    }

    const evidence: Evidence[] = [
      {
        label: "Inquiry",
        detail: `${lead.source} — ${truncateSentence(lead.inquiryContent)}`,
        recordType: "lead",
        recordId: lead.id,
        occurredAt: lead.inquiredAt,
      },
    ];
    if (lead.attemptCount > 0 && lead.lastAttemptAt) {
      evidence.push({
        label: "Contact attempts",
        detail: `${lead.attemptCount} ${lead.attemptCount === 1 ? "attempt" : "attempts"}, last ${relativeDays(lead.lastAttemptAt)}`,
        recordType: "lead",
        recordId: lead.id,
        occurredAt: lead.lastAttemptAt,
      });
    }

    candidates.push({
      key: `lead:${lead.id}`,
      title: `${untouched ? "Contact" : "Follow up with"} ${leadName(lead)}`,
      personId: lead.contactId ?? null,
      personName: leadName(lead),
      relationship: `${capitalize(lead.type)} lead · ${lead.source}`,
      reason,
      urgency,
      score: Math.min(100, score),
      evidence,
      recommendedAction: recommendLeadAction(lead, untouched),
      recommendedChannel: lead.phone ? "call" : "email",
      lastMeaningfulInteraction: lead.lastAttemptAt
        ? `Attempted ${relativeDays(lead.lastAttemptAt)}`
        : `Inquired ${relativeDays(lead.inquiredAt)}`,
      leadId: lead.id,
      messageContext: {
        kind: "lead",
        name: leadName(lead),
        type: lead.type,
        source: lead.source,
        inquiry: lead.inquiryContent,
        desiredArea: lead.desiredArea,
        timeline: lead.estimatedTimeline,
        priceRange: priceRangeLabel(lead),
        propertyAddress: lead.propertyAddress,
        attempts: lead.attemptCount,
      },
    });
  }

  /* --- Transaction deadlines ------------------------------------------- */
  for (const tx of ctx.dataset.transactions) {
    if (ownerOnly && tx.ownerId !== ctx.ownerId) continue;
    if (tx.status === "closed" || tx.status === "terminated") continue;
    const next = tx.milestones
      .filter((m) => !m.complete)
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0];
    if (!next) continue;
    const daysOut = -daysBetween(next.dueAt, now);
    if (daysOut > 3) continue;

    const client = tx.clientContactIds.map((id) => ctx.contactById.get(id)).find(Boolean);
    const property = ctx.propertyById.get(tx.propertyId);
    candidates.push({
      key: `tx:${tx.id}`,
      title: `${next.label} — ${property?.address ?? "transaction"}`,
      personId: client?.id ?? null,
      personName: client ? contactName(client) : null,
      relationship: "Under contract",
      reason:
        daysOut <= 0
          ? `${next.label} was due ${formatDate(next.dueAt)} and is not marked complete.`
          : `${next.label} is due in ${daysOut} ${daysOut === 1 ? "day" : "days"}.`,
      urgency: daysOut <= 1 ? "critical" : "high",
      score: Math.min(100, 78 + (3 - daysOut) * 5),
      evidence: [
        {
          label: "Contract milestone",
          detail: `${next.label} due ${formatDate(next.dueAt)} · contract ${formatDate(tx.contractDate)} at $${tx.contractPrice.toLocaleString()}`,
          recordType: "transaction",
          recordId: tx.id,
          occurredAt: next.dueAt,
        },
      ],
      recommendedAction: `Confirm ${next.label.toLowerCase()} and tell ${client ? client.firstName : "the client"} where it stands.`,
      recommendedChannel: "call",
      lastMeaningfulInteraction: client?.lastPersonalContactAt
        ? `${client.lastPersonalContactChannel ?? "Contact"} · ${relativeDays(client.lastPersonalContactAt)}`
        : null,
      messageContext: {
        kind: "transaction",
        name: client ? contactName(client) : "client",
        milestone: next.label,
        dueAt: next.dueAt,
        address: property?.address,
        status: tx.status,
      },
    });
  }

  /* --- Overdue and today's tasks that carry a person -------------------- */
  for (const task of ctx.dataset.tasks) {
    if (task.status !== "open") continue;
    if (ownerOnly && task.ownerId !== ctx.ownerId) continue;
    const overdueDays = daysBetween(task.dueAt, now);
    if (overdueDays < 0 && !isSameLocalDay(task.dueAt, now)) continue;
    // Leads and transactions are already covered above with better context.
    if (task.leadId || task.transactionId) continue;

    const contact = task.contactId ? ctx.contactById.get(task.contactId) : undefined;
    const listing = task.listingId ? ctx.listingById.get(task.listingId) : undefined;
    const base = URGENCY_RANK[task.urgency] * 12 + 30;
    const score = Math.min(100, base + Math.min(24, Math.max(0, overdueDays) * 8));

    candidates.push({
      key: `task:${task.id}`,
      title: task.title,
      personId: contact?.id ?? null,
      personName: contact ? contactName(contact) : null,
      relationship: contact ? relationshipLabel(contact) : listing ? "Listing work" : "Task",
      reason:
        overdueDays > 0
          ? `Overdue by ${overdueDays} ${overdueDays === 1 ? "day" : "days"}.${task.detail ? ` ${task.detail}` : ""}`
          : `Due today.${task.detail ? ` ${task.detail}` : ""}`,
      urgency: overdueDays >= 2 && task.urgency !== "low" ? escalate(task.urgency) : task.urgency,
      score,
      evidence: buildTaskEvidence(task, listing, ctx),
      recommendedAction: task.title,
      recommendedChannel: contact?.phone ? "call" : "email",
      lastMeaningfulInteraction: contact?.lastPersonalContactAt
        ? `${contact.lastPersonalContactChannel ?? "Contact"} · ${relativeDays(contact.lastPersonalContactAt)}`
        : null,
      taskId: task.id,
      listingId: task.listingId ?? null,
      messageContext: {
        kind: "task",
        name: contact ? contactName(contact) : null,
        task: task.title,
        detail: task.detail,
        listing: listing ? listingAddress(ctx, listing) : null,
      },
    });
  }

  /* --- Relationship decay ---------------------------------------------- */
  for (const scored of scoreAllRelationships(ctx, { ownerOnly })) {
    // Only strong relationship signals compete with dated obligations.
    if (scored.score < 45) continue;
    candidates.push({
      key: `relationship:${scored.contact.id}`,
      title: `${scored.recommendedChannel === "call" ? "Call" : scored.recommendedChannel === "email" ? "Email" : "Reach out to"} ${contactName(scored.contact)}`,
      personId: scored.contact.id,
      personName: contactName(scored.contact),
      relationship: relationshipLabel(scored.contact),
      reason: scored.whyNow,
      urgency: scored.urgency,
      score: Math.round(scored.score * 0.88),
      evidence: scored.evidence,
      recommendedAction: scored.recommendedAction,
      recommendedChannel: scored.recommendedChannel,
      lastMeaningfulInteraction: scored.lastMeaningfulInteraction,
      messageContext: {
        kind: "relationship",
        name: contactName(scored.contact),
        firstName: scored.contact.firstName,
        relationship: relationshipLabel(scored.contact),
        whyNow: scored.whyNow,
        signals: scored.signals.map((s) => s.clause),
        notes: scored.contact.notes.slice(0, 2).map((n) => n.body),
        statedPlans: scored.contact.statedPlans.filter((p) => p.status === "open").map((p) => p.statement),
        neighborhood: scored.contact.neighborhood,
      },
    });
  }

  // De-duplicate: one card per person, keeping the strongest reason.
  const byPerson = new Map<string, PriorityCandidate>();
  const standalone: PriorityCandidate[] = [];
  for (const candidate of candidates) {
    const personKey = candidate.personId ?? candidate.leadId;
    if (!personKey) {
      standalone.push(candidate);
      continue;
    }
    const existing = byPerson.get(personKey);
    if (!existing || candidate.score > existing.score) {
      if (existing) {
        // Fold the weaker card's evidence in rather than losing it.
        candidate.evidence = dedupeEvidence([...candidate.evidence, ...existing.evidence]);
      }
      byPerson.set(personKey, candidate);
    } else {
      existing.evidence = dedupeEvidence([...existing.evidence, ...candidate.evidence]);
    }
  }

  return [...byPerson.values(), ...standalone].sort(
    (a, b) => b.score - a.score || URGENCY_RANK[b.urgency] - URGENCY_RANK[a.urgency],
  );
}

/* --------------------------------------------------------------- metrics */

export function buildMetrics(ctx: WorkContext, opts?: { ownerOnly?: boolean }): DailyMetrics {
  const ownerOnly = opts?.ownerOnly ?? true;
  const now = ctx.now;
  const mine = <T extends { ownerId?: string; assignedTo?: string }>(rows: T[]) =>
    ownerOnly ? rows.filter((r) => (r.ownerId ?? r.assignedTo) === ctx.ownerId) : rows;

  const openTasks = mine(ctx.dataset.tasks).filter((t) => t.status === "open");

  return {
    tasksDue: openTasks.filter((t) => daysBetween(t.dueAt, now) >= 0 || isSameLocalDay(t.dueAt, now)).length,
    newLeads: mine(ctx.dataset.leads).filter(
      (l) => l.stage === "new" || daysBetween(l.inquiredAt, now) < 1,
    ).length,
    followUpsOverdue: countOverdueFollowUps(ctx, ownerOnly),
    appointmentsToday: mine(ctx.dataset.calendarEvents).filter((e) => isSameLocalDay(e.startsAt, now)).length,
    sellerReportsDue: listingsNeedingSellerUpdate(ctx, ownerOnly).length,
    marketingTasksDue: openTasks.filter(
      (t) => t.category === "marketing" && (daysBetween(t.dueAt, now) >= 0 || isSameLocalDay(t.dueAt, now)),
    ).length,
  };
}

function countOverdueFollowUps(ctx: WorkContext, ownerOnly: boolean) {
  const now = ctx.now;
  const leads = ctx.dataset.leads.filter(
    (l) =>
      (!ownerOnly || l.assignedTo === ctx.ownerId) &&
      OPEN_LEAD_STAGES.has(l.stage) &&
      l.followUpDueAt &&
      daysBetween(l.followUpDueAt, now) >= 0,
  ).length;
  const tasks = ctx.dataset.tasks.filter(
    (t) =>
      (!ownerOnly || t.ownerId === ctx.ownerId) &&
      t.status === "open" &&
      t.category === "follow_up" &&
      daysBetween(t.dueAt, now) > 0,
  ).length;
  return leads + tasks;
}

/* -------------------------------------------------------- listing actions */

export function listingsNeedingSellerUpdate(ctx: WorkContext, ownerOnly = true): Listing[] {
  const now = ctx.now;
  return ctx.dataset.listings.filter((l) => {
    if (ownerOnly && l.ownerId !== ctx.ownerId) return false;
    if (!["active", "price_change", "coming_soon", "pending"].includes(l.status)) return false;
    if (!l.lastSellerUpdateAt) return true;
    return daysBetween(l.lastSellerUpdateAt, now) >= l.sellerUpdateCadenceDays;
  });
}

export function buildListingActions(ctx: WorkContext, opts?: { ownerOnly?: boolean }): ListingAction[] {
  const ownerOnly = opts?.ownerOnly ?? true;
  const now = ctx.now;
  const actions: ListingAction[] = [];

  for (const listing of ctx.dataset.listings) {
    if (ownerOnly && listing.ownerId !== ctx.ownerId) continue;
    // A listing that has closed or been withdrawn generates no work. Marketing
    // for a closed sale (the Just Sold post) is tracked as a task instead.
    if (listing.status === "closed" || listing.status === "withdrawn") continue;
    const address = listingAddress(ctx, listing);

    // Seller update overdue.
    const daysSinceUpdate = listing.lastSellerUpdateAt ? daysBetween(listing.lastSellerUpdateAt, now) : null;
    if (
      ["active", "price_change", "coming_soon", "pending"].includes(listing.status) &&
      (daysSinceUpdate === null || daysSinceUpdate >= listing.sellerUpdateCadenceDays)
    ) {
      const existingDraft = ctx.dataset.sellerUpdates.find(
        (u) => u.listingId === listing.id && (u.status === "needs_review" || u.status === "draft"),
      );
      actions.push({
        listingId: listing.id,
        address,
        action: existingDraft ? "Seller update ready to review" : "Weekly seller update due",
        detail:
          daysSinceUpdate === null
            ? `${listing.sellerNames} have not had a written update yet.`
            : `Last update was ${daysSinceUpdate} days ago. ${listing.showingsThisWeek} showings and ${listing.inquiriesThisWeek} inquiries this week.`,
        urgency: daysSinceUpdate !== null && daysSinceUpdate >= listing.sellerUpdateCadenceDays + 2 ? "high" : "medium",
        sellerUpdateId: existingDraft?.id ?? null,
      });
    }

    // Coming soon with no marketing written.
    if (listing.status === "coming_soon" && listing.launchDate) {
      const daysToLaunch = -daysBetween(listing.launchDate, now);
      const hasComingSoon = ctx.dataset.listingMarketing.some(
        (m) => m.listingId === listing.id && m.kind === "coming_soon_post",
      );
      if (!hasComingSoon && daysToLaunch <= 10) {
        actions.push({
          listingId: listing.id,
          address,
          action: "Coming Soon copy not written",
          detail: `Launch is ${daysToLaunch <= 0 ? "today" : `in ${daysToLaunch} days`} and nothing has been drafted.`,
          urgency: daysToLaunch <= 3 ? "high" : "medium",
          marketingAssetKind: "coming_soon_post",
        });
      }
    }

    // Price change with no announcement.
    if (listing.status === "price_change" && listing.listPrice < listing.originalListPrice) {
      const hasAnnouncement = ctx.dataset.listingMarketing.some(
        (m) => m.listingId === listing.id && m.kind === "price_adjustment_post",
      );
      if (!hasAnnouncement) {
        actions.push({
          listingId: listing.id,
          address,
          action: "Price adjustment not announced",
          detail: `Now $${listing.listPrice.toLocaleString()}, down from $${listing.originalListPrice.toLocaleString()}. No announcement has gone out.`,
          urgency: "medium",
          marketingAssetKind: "price_adjustment_post",
        });
      }
    }

    // Showings with unread feedback themes.
    const feedback = ctx.dataset.showingFeedback.filter(
      (f) => f.listingId === listing.id && daysBetween(f.showingAt, now) <= 10,
    );
    const priceObjections = feedback.filter((f) => f.priceReaction === "over");
    if (priceObjections.length >= 2) {
      actions.push({
        listingId: listing.id,
        address,
        action: "Price feedback is consistent",
        detail: `${priceObjections.length} of the last ${feedback.length} showings said the price is above the market. Worth a conversation with ${listing.sellerNames}.`,
        urgency: "high",
      });
    }
  }

  return actions.sort((a, b) => URGENCY_RANK[b.urgency] - URGENCY_RANK[a.urgency]);
}

/* ------------------------------------------------------------- utilities */

function buildTaskEvidence(task: Task, listing: Listing | undefined, ctx: WorkContext): Evidence[] {
  const evidence: Evidence[] = [
    {
      label: "Task",
      detail: `${task.title} — due ${formatDate(task.dueAt)}`,
      recordType: "task",
      recordId: task.id,
      occurredAt: task.dueAt,
    },
  ];
  if (listing) {
    evidence.push({
      label: "Listing",
      detail: `${listingAddress(ctx, listing)} · ${listing.status.replace(/_/g, " ")} at $${listing.listPrice.toLocaleString()}`,
      recordType: "listing",
      recordId: listing.id,
      occurredAt: listing.lastActivityAt ?? null,
    });
  }
  return evidence;
}

function dedupeEvidence(evidence: Evidence[]): Evidence[] {
  const seen = new Set<string>();
  return evidence.filter((e) => {
    const key = `${e.recordType}:${e.recordId}:${e.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function recommendLeadAction(lead: Lead, untouched: boolean) {
  if (untouched) {
    return lead.phone
      ? `Call ${lead.firstName} now, then send a short follow-up email if there is no answer.`
      : `Email ${lead.firstName} now — no phone number was captured, so ask for one.`;
  }
  if (lead.attemptCount >= 2) {
    return `Third attempt. Change the channel: ${lead.phone ? "text rather than call" : "call rather than email"}, and give a specific reason to respond.`;
  }
  return `Follow up with ${lead.firstName} and reference what they actually asked about.`;
}

function priceRangeLabel(lead: Lead) {
  if (lead.priceRangeMin && lead.priceRangeMax) {
    return `$${lead.priceRangeMin.toLocaleString()}–$${lead.priceRangeMax.toLocaleString()}`;
  }
  return null;
}

function escalate(u: Urgency): Urgency {
  if (u === "medium") return "high";
  if (u === "high") return "critical";
  return u;
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function truncateSentence(text: string, max = 160) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}
