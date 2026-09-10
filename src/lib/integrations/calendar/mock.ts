import { randomUUID } from "node:crypto";
import { getStore } from "@/lib/data/store";
import { daysBetween, isSameLocalDay } from "@/lib/utils";
import type { CalendarAdapter, CalendarAppointment } from "./types";

/** Mock calendar backed by the cached calendar events in the dataset. */
export class MockCalendarAdapter implements CalendarAdapter {
  readonly mode = "mock" as const;

  private async all(): Promise<CalendarAppointment[]> {
    const store = await getStore();
    const [events, contacts] = await Promise.all([store.listCalendarEvents(), store.listContacts()]);
    const emailById = new Map(contacts.map((c) => [c.id, c.email]));
    return events
      .map((e) => ({
        id: e.id,
        title: e.title,
        startsAt: e.startsAt,
        endsAt: e.endsAt,
        location: e.location ?? null,
        description: e.notes ?? null,
        attendeeEmails: e.contactIds.map((id) => emailById.get(id)).filter((x): x is string => Boolean(x)),
        externalId: e.sourceId ?? null,
      }))
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }

  async getTodayEvents(): Promise<CalendarAppointment[]> {
    const events = await this.all();
    const now = new Date();
    return events.filter((e) => isSameLocalDay(e.startsAt, now));
  }

  async getUpcomingEvents(opts?: { days?: number; limit?: number }): Promise<CalendarAppointment[]> {
    const events = await this.all();
    const days = opts?.days ?? 7;
    return events
      .filter((e) => {
        const delta = -daysBetween(e.startsAt);
        return delta >= 0 && delta <= days;
      })
      .slice(0, opts?.limit ?? 50);
  }

  async createEvent(input: {
    title: string;
    startsAt: string;
    endsAt: string;
    location?: string;
    description?: string;
    attendeeEmails?: string[];
  }): Promise<CalendarAppointment> {
    return {
      id: randomUUID(),
      title: input.title,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      location: input.location ?? null,
      description: input.description ?? null,
      attendeeEmails: input.attendeeEmails ?? [],
      externalId: null,
    };
  }
}
