import "server-only";
import { getGoogleAccessToken } from "../google-auth";
import { teamDayAt } from "@/lib/utils";
import type { CalendarAdapter, CalendarAppointment } from "./types";

const API = "https://www.googleapis.com/calendar/v3";

/**
 * Google Calendar adapter.
 *
 * Scopes required: `calendar.readonly` for reading, `calendar.events` for
 * creating. Creating an event is a high-consequence action in this product, so
 * it is only ever called from an approved action, never automatically.
 */
export class GoogleCalendarAdapter implements CalendarAdapter {
  readonly mode = "live" as const;

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await getGoogleAccessToken();
    const response = await fetch(`${API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init?.headers },
      cache: "no-store",
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Google Calendar ${init?.method ?? "GET"} ${path} failed: ${response.status} ${body.slice(0, 200)}`);
    }
    return (await response.json()) as T;
  }

  private async list(timeMin: string, timeMax: string, limit: number) {
    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: String(limit),
    });
    const data = await this.request<{ items?: GoogleEvent[] }>(`/calendars/primary/events?${params}`);
    return (data.items ?? []).map(normaliseEvent);
  }

  async getTodayEvents(): Promise<CalendarAppointment[]> {
    return this.list(teamDayAt(0, 0), teamDayAt(1, 0), 50);
  }

  async getUpcomingEvents(opts?: { days?: number; limit?: number }): Promise<CalendarAppointment[]> {
    return this.list(new Date().toISOString(), teamDayAt(opts?.days ?? 7, 23, 59), opts?.limit ?? 50);
  }

  async createEvent(input: {
    title: string;
    startsAt: string;
    endsAt: string;
    location?: string;
    description?: string;
    attendeeEmails?: string[];
  }): Promise<CalendarAppointment> {
    const created = await this.request<GoogleEvent>("/calendars/primary/events", {
      method: "POST",
      body: JSON.stringify({
        summary: input.title,
        location: input.location,
        description: input.description,
        start: { dateTime: input.startsAt },
        end: { dateTime: input.endsAt },
        attendees: input.attendeeEmails?.map((email) => ({ email })),
      }),
    });
    return normaliseEvent(created);
  }
}

interface GoogleEvent {
  id: string;
  summary?: string;
  location?: string;
  description?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { email?: string }[];
}

function normaliseEvent(e: GoogleEvent): CalendarAppointment {
  return {
    id: e.id,
    title: e.summary ?? "(no title)",
    startsAt: e.start?.dateTime ?? `${e.start?.date ?? ""}T00:00:00.000Z`,
    endsAt: e.end?.dateTime ?? `${e.end?.date ?? ""}T00:00:00.000Z`,
    location: e.location ?? null,
    description: e.description ?? null,
    attendeeEmails: (e.attendees ?? []).map((a) => a.email).filter((x): x is string => Boolean(x)),
    externalId: e.id,
  };
}
