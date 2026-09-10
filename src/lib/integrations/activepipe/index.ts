import "server-only";
import { capabilities } from "@/lib/env";
import { getStore } from "@/lib/data/store";
import { daysBetween } from "@/lib/utils";
import type { AdapterInfo } from "../types";
import type { EmailEngagementType, UUID } from "@/lib/types";

/**
 * ActivePipe — engagement signals only.
 *
 * ActivePipe keeps running database nurture and email marketing. This product
 * does not replace it and does not send campaigns. It consumes engagement
 * events (opens, clicks, property clicks, replies) and uses them to decide who
 * deserves a *personal* follow-up — which is the thing automated nurture cannot
 * do.
 */

export interface EngagementEvent {
  id: string;
  contactId: UUID | null;
  contactEmail: string;
  type: EmailEngagementType;
  occurredAt: string;
  campaignName?: string | null;
  subject?: string | null;
  propertyAddress?: string | null;
}

export interface EngagementSummary {
  contactId: UUID;
  opens: number;
  clicks: number;
  propertyClicks: number;
  lastEngagedAt: string | null;
  /** Distinct campaigns opened — a better signal than raw open count. */
  campaignsEngaged: number;
}

export interface ActivePipeAdapter {
  readonly mode: "mock" | "live";
  getEngagementEvents(opts?: { sinceDays?: number; contactId?: UUID }): Promise<EngagementEvent[]>;
  summarizeEngagement(opts?: { sinceDays?: number }): Promise<EngagementSummary[]>;
}

class MockActivePipeAdapter implements ActivePipeAdapter {
  readonly mode = "mock" as const;

  async getEngagementEvents(opts?: { sinceDays?: number; contactId?: UUID }): Promise<EngagementEvent[]> {
    const store = await getStore();
    const events = await store.listEmailEvents();
    const sinceDays = opts?.sinceDays ?? 180;
    return events
      .filter((e) => ["email_open", "email_click", "campaign_response", "property_click"].includes(e.type))
      .filter((e) => daysBetween(e.occurredAt) <= sinceDays)
      .filter((e) => (opts?.contactId ? e.contactId === opts.contactId : true))
      .map((e) => ({
        id: e.id,
        contactId: e.contactId ?? null,
        contactEmail: e.contactEmail,
        type: e.type,
        occurredAt: e.occurredAt,
        campaignName: e.campaignName ?? null,
        subject: e.subject ?? null,
        propertyAddress: e.propertyAddress ?? null,
      }));
  }

  async summarizeEngagement(opts?: { sinceDays?: number }): Promise<EngagementSummary[]> {
    const events = await this.getEngagementEvents({ sinceDays: opts?.sinceDays });
    const byContact = new Map<UUID, EngagementEvent[]>();
    for (const event of events) {
      if (!event.contactId) continue;
      const list = byContact.get(event.contactId);
      if (list) list.push(event);
      else byContact.set(event.contactId, [event]);
    }
    return [...byContact.entries()]
      .map(([contactId, list]) => ({
        contactId,
        opens: list.filter((e) => e.type === "email_open").length,
        clicks: list.filter((e) => e.type === "email_click").length,
        propertyClicks: list.filter((e) => e.type === "property_click").length,
        lastEngagedAt: list.map((e) => e.occurredAt).sort().at(-1) ?? null,
        campaignsEngaged: new Set(list.map((e) => e.campaignName).filter(Boolean)).size,
      }))
      .sort((a, b) => b.opens + b.clicks * 2 - (a.opens + a.clicks * 2));
  }
}

let cached: ActivePipeAdapter | null = null;

export async function getActivePipeAdapter(): Promise<ActivePipeAdapter> {
  if (cached) return cached;
  // TODO(credentials): implement a live adapter against the ActivePipe API once
  // an API key is issued. Only the read side is needed — campaign sending stays
  // in ActivePipe.
  cached = new MockActivePipeAdapter();
  return cached;
}

export function activePipeInfo(): AdapterInfo {
  return {
    provider: "activepipe",
    mode: "mock",
    status: capabilities.activepipe ? "needs_setup" : "needs_setup",
    requires: ["ACTIVEPIPE_API_KEY"],
    notes:
      "Read-only. ActivePipe keeps running database nurture; this product reads engagement to decide who deserves a personal call. Engagement events currently come from the local cache.",
  };
}
