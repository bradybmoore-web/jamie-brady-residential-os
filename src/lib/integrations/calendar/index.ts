import "server-only";
import { capabilities } from "@/lib/env";
import type { AdapterInfo } from "../types";
import { MockCalendarAdapter } from "./mock";
import type { CalendarAdapter } from "./types";

export * from "./types";

let cached: CalendarAdapter | null = null;

export async function getCalendarAdapter(): Promise<CalendarAdapter> {
  if (cached) return cached;
  if (capabilities.google) {
    const { GoogleCalendarAdapter } = await import("./google");
    cached = new GoogleCalendarAdapter();
  } else {
    cached = new MockCalendarAdapter();
  }
  return cached;
}

export function calendarInfo(): AdapterInfo {
  return {
    provider: "google_calendar",
    mode: capabilities.google ? "live" : "mock",
    status: capabilities.google ? "connected" : "needs_setup",
    requires: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"],
    notes: "Shares the Google OAuth client with Gmail. Creating or moving an appointment always requires approval.",
  };
}
