import "server-only";
import { getStore } from "@/lib/data/store";
import { getEmailAdapter } from "@/lib/integrations/email";
import { getMlsProvider } from "@/lib/integrations/mls";
import { buildContext } from "@/lib/scoring/context";
import { buildPriorities } from "@/lib/scoring/priorities";
import { dailyCommandCenter } from "@/lib/workflows/daily-command-center";
import {
  CONTACT_TYPE_LABELS,
  LISTING_STATUS_LABELS,
  contactName,
  leadName,
  type UUID,
} from "@/lib/types";
import { formatCurrency, formatDate, formatTime, isSameLocalDay, relativeDays } from "@/lib/utils";
import type { AIToolDefinition } from "./provider";

/**
 * The tool registry.
 *
 * Every tool is a plain async function over the `DataStore` and the integration
 * adapters — the same code paths the pages use. There is no separate "AI data
 * layer" to drift out of sync.
 *
 * Tools return **formatted text**, not JSON. The model reads prose better than
 * it reads nested objects, and it keeps the tool output legible in the
 * transparency panel where Jamie can check what the assistant actually looked at.
 *
 * Read tools are safe to call freely. Write tools (`createTask`, `draftEmail`)
 * produce drafts and tasks only — nothing outbound, nothing destructive.
 */

export interface ToolContext {
  ownerId: UUID;
}

export interface RegisteredTool {
  definition: AIToolDefinition;
  /** True for anything that mutates state. */
  writes: boolean;
  run(input: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}

const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const num = (v: unknown) => (typeof v === "number" ? v : undefined);
const bool = (v: unknown) => (typeof v === "boolean" ? v : undefined);

function none(what: string) {
  return `No ${what} matched.`;
}

export const TOOLS: Record<string, RegisteredTool> = {
  /* ------------------------------------------------------------ contacts */
  searchContacts: {
    writes: false,
    definition: {
      name: "searchContacts",
      description:
        "Search the contact database by name, email, city, neighborhood, tag, or relationship type. Use this to answer questions about who is in the database.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Free text: a name, neighborhood, city, or tag" },
          type: {
            type: "string",
            enum: ["lead", "active_buyer", "active_seller", "past_client", "sphere", "agent", "vendor"],
            description: "Restrict to one relationship type",
          },
          limit: { type: "number", description: "Maximum results, default 15" },
        },
      },
    },
    async run(input) {
      const store = await getStore();
      const contacts = await store.listContacts();
      const q = str(input.query)?.toLowerCase().trim();
      const type = str(input.type);
      const results = contacts
        .filter((c) => (type ? c.type === type : true))
        .filter((c) => {
          if (!q) return true;
          return [contactName(c), c.email, c.city, c.neighborhood, ...c.tags, ...c.notes.map((n) => n.body)]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(q);
        })
        .slice(0, num(input.limit) ?? 15);

      if (results.length === 0) return none("contacts");
      return results
        .map(
          (c) =>
            `${contactName(c)} — ${CONTACT_TYPE_LABELS[c.type]}${c.neighborhood ? `, ${c.neighborhood}` : ""}. Last personal contact ${relativeDays(c.lastPersonalContactAt)}. Tags: ${c.tags.join(", ") || "none"}. [id: ${c.id}]`,
        )
        .join("\n");
    },
  },

  getContact: {
    writes: false,
    definition: {
      name: "getContact",
      description:
        "Get the full record for one contact: relationship history, notes, stated plans, buyer profile if they have one, and recent email engagement.",
      inputSchema: {
        type: "object",
        properties: { contactId: { type: "string", description: "The contact id" } },
        required: ["contactId"],
      },
    },
    async run(input) {
      const store = await getStore();
      const id = str(input.contactId);
      if (!id) return "contactId is required.";
      const contact = await store.getContact(id);
      if (!contact) return `No contact with id ${id}.`;

      const [buyers, events] = await Promise.all([store.listBuyers(), store.listEmailEvents()]);
      const buyer = buyers.find((b) => b.contactId === id);
      const engagement = events.filter((e) => e.contactId === id).slice(0, 8);

      const lines = [
        `${contactName(contact)} — ${CONTACT_TYPE_LABELS[contact.type]}, stage ${contact.stage}`,
        contact.email ? `Email: ${contact.email}` : null,
        contact.phone ? `Phone: ${contact.phone}` : null,
        contact.neighborhood ? `Area: ${contact.neighborhood}, ${contact.city ?? ""}` : null,
        `Last personal contact: ${relativeDays(contact.lastPersonalContactAt)}${contact.lastPersonalContactChannel ? ` (${contact.lastPersonalContactChannel})` : ""}`,
        contact.tags.length ? `Tags: ${contact.tags.join(", ")}` : null,
      ].filter(Boolean);

      if (contact.statedPlans.length > 0) {
        lines.push(
          "",
          "What they have said:",
          ...contact.statedPlans.map((p) => `- "${p.statement}" (said ${formatDate(p.statedAt)}, due ${formatDate(p.maturesAt)}, ${p.status})`),
        );
      }
      if (contact.notes.length > 0) {
        lines.push("", "Notes:", ...contact.notes.slice(0, 4).map((n) => `- ${formatDate(n.createdAt)}: ${n.body}`));
      }
      if (buyer) {
        lines.push(
          "",
          `Buyer profile: ${formatCurrency(buyer.priceMin)}–${formatCurrency(buyer.priceMax)}, ${buyer.minBeds}+ bed, ${buyer.minBaths}+ bath in ${buyer.targetLocations.join(", ")}.`,
          `Must have: ${buyer.mustHaves.join("; ") || "none recorded"}. Deal breakers: ${buyer.dealBreakers.join("; ") || "none recorded"}.`,
          `Pool: ${buyer.poolPreference}. One story: ${buyer.oneStoryPreference}. Timeline: ${buyer.timeline ?? "not stated"}.`,
        );
      }
      if (engagement.length > 0) {
        lines.push(
          "",
          "Recent email activity:",
          ...engagement.map((e) => `- ${formatDate(e.occurredAt)}: ${e.type}${e.subject ? ` — ${e.subject}` : ""}${e.propertyAddress ? ` (${e.propertyAddress})` : ""}`),
        );
      }
      return lines.join("\n");
    },
  },

  /* ------------------------------------------------------------ listings */
  getListings: {
    writes: false,
    definition: {
      name: "getListings",
      description: "List the team's listings with status, price, days on market, and recent activity.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Match an address or neighborhood" },
          status: {
            type: "string",
            enum: ["pre_listing", "coming_soon", "active", "price_change", "pending", "closed", "withdrawn"],
          },
        },
      },
    },
    async run(input, ctx) {
      const store = await getStore();
      const dataset = await store.snapshot();
      const wc = buildContext(dataset, ctx.ownerId);
      const q = str(input.query)?.toLowerCase();
      const status = str(input.status);

      const results = dataset.listings
        .filter((l) => (status ? l.status === status : true))
        .filter((l) => {
          if (!q) return true;
          const property = wc.propertyById.get(l.propertyId);
          return `${property?.address ?? ""} ${property?.neighborhood ?? ""} ${property?.city ?? ""}`
            .toLowerCase()
            .includes(q);
        });

      if (results.length === 0) return none("listings");
      return results
        .map((l) => {
          const p = wc.propertyById.get(l.propertyId);
          return [
            `${p?.address ?? "Unknown"}, ${p?.city ?? ""} — ${LISTING_STATUS_LABELS[l.status]} at ${formatCurrency(l.listPrice)}`,
            `  ${p?.beds ?? "?"} bed / ${p?.baths ?? "?"} bath / ${p?.squareFeet?.toLocaleString() ?? "?"} sq ft. Sellers: ${l.sellerNames}.`,
            `  ${l.showingsThisWeek} showings this week, ${l.totalShowings} total, ${l.inquiriesThisWeek} inquiries.`,
            l.lastActivitySummary ? `  Latest: ${l.lastActivitySummary}` : null,
            `  [id: ${l.id}]`,
          ]
            .filter(Boolean)
            .join("\n");
        })
        .join("\n\n");
    },
  },

  getListing: {
    writes: false,
    definition: {
      name: "getListing",
      description:
        "Full detail for one listing: features, improvements, positioning, seller writing notes, prohibited phrases, showings and feedback.",
      inputSchema: {
        type: "object",
        properties: { listingId: { type: "string" } },
        required: ["listingId"],
      },
    },
    async run(input) {
      const store = await getStore();
      const id = str(input.listingId);
      if (!id) return "listingId is required.";
      const listing = await store.getListing(id);
      if (!listing) return `No listing with id ${id}.`;
      const [property, feedback] = await Promise.all([
        store.getProperty(listing.propertyId),
        store.listShowingFeedback(),
      ]);
      const mine = feedback.filter((f) => f.listingId === id).slice(0, 5);

      return [
        `${property?.address} — ${LISTING_STATUS_LABELS[listing.status]} at ${formatCurrency(listing.listPrice)}${listing.listPrice !== listing.originalListPrice ? ` (originally ${formatCurrency(listing.originalListPrice)})` : ""}`,
        `${property?.beds} bed / ${property?.baths} bath / ${property?.squareFeet?.toLocaleString()} sq ft, built ${property?.yearBuilt}, ${property?.lotSizeAcres} acre lot`,
        `Sellers: ${listing.sellerNames}`,
        "",
        `Positioning: ${listing.positioning}`,
        "",
        `Features:\n${listing.majorFeatures.map((f) => `- ${f}`).join("\n")}`,
        listing.improvements.length ? `\nImprovements:\n${listing.improvements.map((f) => `- ${f}`).join("\n")}` : "",
        listing.lifestylePoints.length ? `\nLifestyle:\n${listing.lifestylePoints.map((f) => `- ${f}`).join("\n")}` : "",
        listing.writingNotes ? `\nWriting notes: ${listing.writingNotes}` : "",
        listing.prohibitedPhrases.length ? `Prohibited phrases: ${listing.prohibitedPhrases.join(", ")}` : "",
        mine.length ? `\nRecent showing feedback:\n${mine.map((f) => `- ${formatDate(f.showingAt)} (${f.agentName}): ${f.buyerImpression}, price ${f.priceReaction}. ${f.comments}`).join("\n")}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    },
  },

  /* --------------------------------------------------------------- leads */
  getLeads: {
    writes: false,
    definition: {
      name: "getLeads",
      description: "List leads with score, stage, urgency and what they asked for.",
      inputSchema: {
        type: "object",
        properties: {
          stage: { type: "string", description: "Restrict to one lead stage" },
          minScore: { type: "number", description: "Only leads at or above this score" },
        },
      },
    },
    async run(input) {
      const store = await getStore();
      const leads = await store.listLeads();
      const stage = str(input.stage);
      const minScore = num(input.minScore) ?? 0;
      const results = leads
        .filter((l) => (stage ? l.stage === stage : true))
        .filter((l) => l.score >= minScore)
        .sort((a, b) => b.score - a.score);
      if (results.length === 0) return none("leads");
      return results
        .map(
          (l) =>
            `${leadName(l)} — ${l.type}, score ${l.score}, ${l.urgency} urgency, stage ${l.stage}. From ${l.source}, ${relativeDays(l.inquiredAt)}. ${l.attemptCount} contact attempts.\n  "${l.inquiryContent.slice(0, 180)}${l.inquiryContent.length > 180 ? "…" : ""}"\n  [id: ${l.id}]`,
        )
        .join("\n\n");
    },
  },

  /* -------------------------------------------------------------- buyers */
  getBuyers: {
    writes: false,
    definition: {
      name: "getBuyers",
      description:
        "List active buyer profiles with their criteria. Use this to answer questions like which buyers want a pool, or who is looking in a given area.",
      inputSchema: {
        type: "object",
        properties: {
          requirement: {
            type: "string",
            description: "A feature to filter on, e.g. 'pool', 'one story', 'view'",
          },
          location: { type: "string", description: "Target area to filter on" },
          maxPrice: { type: "number" },
        },
      },
    },
    async run(input) {
      const store = await getStore();
      const [buyers, contacts] = await Promise.all([store.listBuyers(), store.listContacts()]);
      const byId = new Map(contacts.map((c) => [c.id, c]));
      const requirement = str(input.requirement)?.toLowerCase();
      const location = str(input.location)?.toLowerCase();
      const maxPrice = num(input.maxPrice);

      const results = buyers
        .filter((b) => b.active)
        .filter((b) => {
          if (!requirement) return true;
          if (requirement.includes("pool")) return b.poolPreference === "required" || b.poolPreference === "preferred";
          if (requirement.includes("story") || requirement.includes("single"))
            return b.oneStoryPreference === "required" || b.oneStoryPreference === "preferred";
          const haystack = [...b.mustHaves, ...b.niceToHaves, b.viewPreference, b.lotPreference]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return haystack.includes(requirement);
        })
        .filter((b) => (location ? b.targetLocations.some((l) => l.toLowerCase().includes(location)) : true))
        .filter((b) => (maxPrice ? b.priceMin <= maxPrice : true));

      if (results.length === 0) return none("active buyers");
      return results
        .map((b) => {
          const c = byId.get(b.contactId);
          return [
            `${c ? contactName(c) : "Unknown buyer"} — ${formatCurrency(b.priceMin)}–${formatCurrency(b.priceMax)} in ${b.targetLocations.join(", ")}`,
            `  ${b.minBeds}+ bed, ${b.minBaths}+ bath. Pool: ${b.poolPreference}. One story: ${b.oneStoryPreference}.`,
            `  Must have: ${b.mustHaves.join("; ") || "none"}. Deal breakers: ${b.dealBreakers.join("; ") || "none"}.`,
            `  Timeline: ${b.timeline ?? "not stated"}. Last showing ${relativeDays(b.lastShowingAt)}.`,
            c ? `  [contactId: ${c.id}]` : "",
          ]
            .filter(Boolean)
            .join("\n");
        })
        .join("\n\n");
    },
  },

  /* --------------------------------------------------------------- tasks */
  getTasks: {
    writes: false,
    definition: {
      name: "getTasks",
      description: "List open tasks, optionally only those overdue or due today.",
      inputSchema: {
        type: "object",
        properties: {
          overdueOnly: { type: "boolean" },
          category: { type: "string", description: "follow_up, marketing, seller_update, transaction, admin, prospecting" },
        },
      },
    },
    async run(input, ctx) {
      const store = await getStore();
      const tasks = await store.listTasks();
      const now = new Date();
      const category = str(input.category);
      const results = tasks
        .filter((t) => t.status === "open" && t.ownerId === ctx.ownerId)
        .filter((t) => (category ? t.category === category : true))
        .filter((t) => (bool(input.overdueOnly) ? new Date(t.dueAt) < now : true))
        .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
      if (results.length === 0) return none("open tasks");
      return results
        .map(
          (t) =>
            `${new Date(t.dueAt) < now ? "OVERDUE" : "Due"} ${formatDate(t.dueAt)} — ${t.title} (${t.category}, ${t.urgency})${t.detail ? `\n  ${t.detail}` : ""}`,
        )
        .join("\n");
    },
  },

  createTask: {
    writes: true,
    definition: {
      name: "createTask",
      description:
        "Create a task for Jamie. Use this when she asks you to remind her or add something to her list. Does not send anything to anyone.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          detail: { type: "string" },
          dueAt: { type: "string", description: "ISO 8601 timestamp" },
          category: { type: "string", description: "follow_up, marketing, seller_update, transaction, admin, prospecting" },
          urgency: { type: "string", enum: ["low", "medium", "high", "critical"] },
          contactId: { type: "string" },
          listingId: { type: "string" },
        },
        required: ["title", "dueAt"],
      },
    },
    async run(input, ctx) {
      const store = await getStore();
      const title = str(input.title);
      const dueAt = str(input.dueAt);
      if (!title || !dueAt) return "title and dueAt are required.";
      const task = await store.createTask({
        title,
        detail: str(input.detail) ?? null,
        category: (str(input.category) as never) ?? "follow_up",
        status: "open",
        dueAt,
        ownerId: ctx.ownerId,
        contactId: str(input.contactId) ?? null,
        listingId: str(input.listingId) ?? null,
        urgency: (str(input.urgency) as never) ?? "medium",
        createdByAi: true,
        sourceSystem: "ai",
      });
      return `Created task "${task.title}" due ${formatDate(task.dueAt)}.`;
    },
  },

  /* ------------------------------------------------------------ calendar */
  getCalendarEvents: {
    writes: false,
    definition: {
      name: "getCalendarEvents",
      description: "Get today's appointments or the next several days, with preparation status.",
      inputSchema: {
        type: "object",
        properties: { todayOnly: { type: "boolean" }, days: { type: "number" } },
      },
    },
    async run(input, ctx) {
      const store = await getStore();
      const [events, contacts] = await Promise.all([store.listCalendarEvents(), store.listContacts()]);
      const byId = new Map(contacts.map((c) => [c.id, c]));
      const now = new Date();
      const todayOnly = bool(input.todayOnly) ?? true;
      const days = num(input.days) ?? 7;

      const results = events
        .filter((e) => e.ownerId === ctx.ownerId)
        .filter((e) => {
          if (todayOnly) return isSameLocalDay(e.startsAt, now);
          const delta = (new Date(e.startsAt).getTime() - now.getTime()) / 86_400_000;
          return delta >= -1 && delta <= days;
        })
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

      if (results.length === 0) return todayOnly ? "Nothing on the calendar today." : none("appointments");
      return results
        .map((e) => {
          const people = e.contactIds.map((id) => byId.get(id)).filter(Boolean).map((c) => contactName(c!));
          return `${formatDate(e.startsAt)} ${formatTime(e.startsAt)}–${formatTime(e.endsAt)} — ${e.title}${e.location ? `\n  ${e.location}` : ""}${people.length ? `\n  With: ${people.join(", ")}` : ""}\n  Prep: ${e.prepStatus.replace(/_/g, " ")}. [id: ${e.id}]`;
        })
        .join("\n\n");
    },
  },

  /* --------------------------------------------------------------- email */
  searchEmails: {
    writes: false,
    definition: {
      name: "searchEmails",
      description:
        "Search email. Set awaitingReplyOnly to find messages nobody has answered. Returns subject, sender and a snippet.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          contactEmail: { type: "string" },
          awaitingReplyOnly: { type: "boolean" },
          limit: { type: "number" },
        },
      },
    },
    async run(input) {
      const adapter = await getEmailAdapter();
      const messages = bool(input.awaitingReplyOnly)
        ? await adapter.findUnanswered({ limit: num(input.limit) ?? 15 })
        : await adapter.searchEmails({
            query: str(input.query),
            contactEmail: str(input.contactEmail),
            limit: num(input.limit) ?? 15,
          });
      if (messages.length === 0) return none("emails");
      const prefix = adapter.mode === "mock" ? "(Gmail is not connected; reading the local cache.)\n\n" : "";
      return (
        prefix +
        messages
          .map(
            (m) =>
              `${formatDate(m.receivedAt)} — ${m.direction === "inbound" ? "From" : "To"} ${m.direction === "inbound" ? m.from : m.to.join(", ")}\n  ${m.subject}\n  ${m.snippet}`,
          )
          .join("\n\n")
      );
    },
  },

  draftEmail: {
    writes: true,
    definition: {
      name: "draftEmail",
      description:
        "Draft an email for Jamie to review. It is NOT sent — it goes to the approval queue where she reads, edits and sends it herself. Always use this rather than claiming you sent something.",
      inputSchema: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient email address" },
          subject: { type: "string" },
          body: { type: "string" },
          contactId: { type: "string" },
        },
        required: ["subject", "body"],
      },
    },
    async run(input, ctx) {
      const store = await getStore();
      const subject = str(input.subject);
      const body = str(input.body);
      if (!subject || !body) return "subject and body are required.";

      const run = await store.createAIRun({
        workflow: "assistant",
        promptVersion: "assistant@1",
        model: "tool",
        provider: "mock",
        inputRecordIds: str(input.contactId) ? [{ recordType: "contact", recordId: str(input.contactId)! }] : [],
        status: "success",
        latencyMs: 0,
        outputSummary: `Assistant drafted an email: ${subject}`,
        startedAt: new Date().toISOString(),
        ownerId: ctx.ownerId,
        sourceSystem: "ai",
      });

      await store.createAIAction({
        aiRunId: run.id,
        workflow: "assistant",
        type: "email_draft",
        status: "needs_review",
        title: `Draft: ${subject}`,
        body,
        subject,
        recipient: str(input.to) ?? null,
        contactId: str(input.contactId) ?? null,
        confidence: 0.6,
        evidence: [],
        ownerId: ctx.ownerId,
        requiresApproval: true,
        sourceSystem: "ai",
      });

      return `Draft saved to the approval queue: "${subject}". It has not been sent — Jamie reviews and sends it from Approvals.`;
    },
  },

  /* ------------------------------------------------------- opportunities */
  getOpportunities: {
    writes: false,
    definition: {
      name: "getOpportunities",
      description:
        "Relationship opportunities the system has identified: who is going cold, whose stated plans have come due, who is engaging without talking to anyone.",
      inputSchema: {
        type: "object",
        properties: { limit: { type: "number" }, minScore: { type: "number" } },
      },
    },
    async run(input, ctx) {
      const store = await getStore();
      let opportunities = (await store.listOpportunities()).filter((o) => o.status === "open");
      if (opportunities.length === 0) {
        const { identifyFollowUpOpportunities } = await import("@/lib/workflows/follow-up");
        const result = await identifyFollowUpOpportunities(ctx.ownerId);
        opportunities = result.opportunities;
      }
      const minScore = num(input.minScore) ?? 0;
      const results = opportunities
        .filter((o) => o.score >= minScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, num(input.limit) ?? 10);
      if (results.length === 0) return none("open opportunities");
      return results
        .map(
          (o) =>
            `${o.title} (score ${o.score}, ${o.urgency}, confidence ${Math.round(o.confidence * 100)}%)\n  Why now: ${o.whyNow}\n  Recommended: ${o.recommendedAction} (${o.recommendedChannel})\n  Evidence: ${o.supportingEvidence.map((e) => e.detail).join(" | ") || "none"}`,
        )
        .join("\n\n");
    },
  },

  getDailyPriorities: {
    writes: false,
    definition: {
      name: "getDailyPriorities",
      description:
        "Today's ranked priorities — who needs attention and why. Use this for questions like 'who should I call today'.",
      inputSchema: { type: "object", properties: { limit: { type: "number" } } },
    },
    async run(input, ctx) {
      const store = await getStore();
      const dataset = await store.snapshot();
      const wc = buildContext(dataset, ctx.ownerId);
      const priorities = buildPriorities(wc, { ownerOnly: true }).slice(0, num(input.limit) ?? 8);
      if (priorities.length === 0) return "Nothing is outstanding today.";
      return priorities
        .map(
          (p, i) =>
            `${i + 1}. ${p.title} (${p.urgency}, score ${p.score})\n   Why: ${p.reason}\n   Do: ${p.recommendedAction}\n   Evidence: ${p.evidence.map((e) => e.detail).join(" | ")}`,
        )
        .join("\n\n");
    },
  },

  /* -------------------------------------------------------- transactions */
  getTransactions: {
    writes: false,
    definition: {
      name: "getTransactions",
      description: "Open transactions with their next milestone and closing date.",
      inputSchema: { type: "object", properties: {} },
    },
    async run(_input, ctx) {
      const store = await getStore();
      const [transactions, properties, contacts] = await Promise.all([
        store.listTransactions(),
        store.listProperties(),
        store.listContacts(),
      ]);
      const addr = new Map(properties.map((p) => [p.id, p.address]));
      const byId = new Map(contacts.map((c) => [c.id, c]));
      const results = transactions.filter(
        (t) => t.ownerId === ctx.ownerId && t.status !== "closed" && t.status !== "terminated",
      );
      if (results.length === 0) return none("open transactions");
      return results
        .map((t) => {
          const next = t.milestones.filter((m) => !m.complete).sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0];
          const clients = t.clientContactIds.map((id) => byId.get(id)).filter(Boolean).map((c) => contactName(c!));
          return `${addr.get(t.propertyId)} — ${t.side} side, ${t.status.replace(/_/g, " ")}, ${formatCurrency(t.contractPrice)}\n  Closing ${formatDate(t.closeDate)}. ${clients.length ? `Client: ${clients.join(", ")}.` : ""}\n  Next: ${next ? `${next.label} due ${formatDate(next.dueAt)}` : "nothing outstanding"}`;
        })
        .join("\n\n");
    },
  },

  /* ------------------------------------------------------------ workflows */
  prepareAppointment: {
    writes: true,
    definition: {
      name: "prepareAppointment",
      description:
        "Build a preparation brief for one appointment: who they are, recent communication, known goals, prior notes, the related property, open questions and talking points.",
      inputSchema: {
        type: "object",
        properties: { calendarEventId: { type: "string" } },
        required: ["calendarEventId"],
      },
    },
    async run(input, ctx) {
      const id = str(input.calendarEventId);
      if (!id) return "calendarEventId is required.";
      const { prepareAppointment } = await import("@/lib/workflows/appointment-prep");
      const { prep } = await prepareAppointment(id, ctx.ownerId);
      return [
        prep.contactSummary,
        prep.knownGoals.length ? `\nGoals:\n${prep.knownGoals.map((g) => `- ${g}`).join("\n")}` : "",
        prep.recentCommunication.length ? `\nRecent communication:\n${prep.recentCommunication.map((c) => `- ${c}`).join("\n")}` : "",
        prep.outstandingQuestions.length ? `\nOpen questions:\n${prep.outstandingQuestions.map((q) => `- ${q}`).join("\n")}` : "",
        prep.talkingPoints.length ? `\nTalking points:\n${prep.talkingPoints.map((t) => `- ${t}`).join("\n")}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    },
  },

  generateListingMarketing: {
    writes: true,
    definition: {
      name: "generateListingMarketing",
      description:
        "Generate marketing copy for a listing. Saves a draft in the Listing Studio for review; it is not published.",
      inputSchema: {
        type: "object",
        properties: {
          listingId: { type: "string" },
          kind: {
            type: "string",
            description:
              "mls_description, instagram_caption, facebook_caption, reel_caption, video_script_30, video_script_60, agent_email, database_email, neighbor_email, coming_soon_post, open_house_post, price_adjustment_post, pending_post, just_sold_post, feature_captions, hashtags",
          },
        },
        required: ["listingId", "kind"],
      },
    },
    async run(input, ctx) {
      const listingId = str(input.listingId);
      const kind = str(input.kind);
      if (!listingId || !kind) return "listingId and kind are required.";
      const { generateListingMarketing } = await import("@/lib/workflows/listing-marketing");
      const { asset, flagged } = await generateListingMarketing(listingId, kind as never, ctx.ownerId);
      return `Draft saved to the Listing Studio.${flagged.length ? ` Flagged phrases to review: ${flagged.join(", ")}.` : ""}\n\n${asset.content}`;
    },
  },

  getMarketComparables: {
    writes: false,
    definition: {
      name: "getMarketComparables",
      description:
        "Competing actives, pendings, recent sales and price reductions for an area. Note that MLS data is currently a mock feed.",
      inputSchema: {
        type: "object",
        properties: {
          postalCode: { type: "string" },
          priceMin: { type: "number" },
          priceMax: { type: "number" },
        },
        required: ["postalCode"],
      },
    },
    async run(input) {
      const postalCode = str(input.postalCode);
      if (!postalCode) return "postalCode is required.";
      const mls = await getMlsProvider();
      const comps = await mls.getComparables({
        postalCode,
        priceMin: num(input.priceMin),
        priceMax: num(input.priceMax),
      });
      const fmt = (label: string, rows: { address: string; listPrice: number; closePrice?: number | null; daysOnMarket: number }[]) =>
        rows.length
          ? `${label} (${rows.length}):\n${rows.map((r) => `- ${r.address} — ${formatCurrency(r.closePrice ?? r.listPrice)}, ${r.daysOnMarket} DOM`).join("\n")}`
          : `${label}: none`;
      return [
        mls.mode === "mock" ? "(MLS is not connected. This is the local mock feed, not licensed data.)\n" : "",
        fmt("Active", comps.actives),
        fmt("Pending", comps.pendings),
        fmt("Sold", comps.solds),
        fmt("Reduced price", comps.priceReductions),
      ]
        .filter(Boolean)
        .join("\n\n");
    },
  },

  runDailyBrief: {
    writes: true,
    definition: {
      name: "runDailyBrief",
      description:
        "Regenerate today's briefing from scratch. Use only when Jamie explicitly asks for a fresh brief.",
      inputSchema: { type: "object", properties: {} },
    },
    async run(_input, ctx) {
      const { brief } = await dailyCommandCenter(ctx.ownerId, { force: true });
      return `Regenerated. ${brief.peopleNeedingAttention.length} people need attention, ${brief.metrics.tasksDue} tasks due, ${brief.metrics.appointmentsToday} appointments today.`;
    },
  },
};

export function toolDefinitions(): AIToolDefinition[] {
  return Object.values(TOOLS).map((t) => t.definition);
}

export function toolNames(): string[] {
  return Object.keys(TOOLS);
}

/** Runs one tool by name. Unknown names return an error string, not a throw. */
export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const tool = TOOLS[name];
  if (!tool) return `Unknown tool "${name}". Available tools: ${toolNames().join(", ")}.`;
  try {
    return await tool.run(input, ctx);
  } catch (error) {
    return `Tool "${name}" failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}
