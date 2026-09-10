export interface CalendarAppointment {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  location?: string | null;
  description?: string | null;
  attendeeEmails: string[];
  /** Provider-native id, so an event can be traced back to Google. */
  externalId?: string | null;
}

export interface CalendarAdapter {
  readonly mode: "mock" | "live";
  getTodayEvents(ownerEmail?: string): Promise<CalendarAppointment[]>;
  getUpcomingEvents(opts?: { days?: number; limit?: number }): Promise<CalendarAppointment[]>;
  createEvent(input: {
    title: string;
    startsAt: string;
    endsAt: string;
    location?: string;
    description?: string;
    attendeeEmails?: string[];
  }): Promise<CalendarAppointment>;
}
