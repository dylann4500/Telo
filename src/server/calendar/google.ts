import { googleFetch } from "../google/auth";
import { localIso } from "../time";
import type { BusySlot, CalendarProvider, NewCalendarEvent } from "./provider";

// Google Calendar, primary calendar only. freeBusy needs the calendar.freebusy
// scope (calendar.events doesn't cover it); events.insert needs calendar.events.

const BASE = "https://www.googleapis.com/calendar/v3";

export class GoogleCalendar implements CalendarProvider {
  readonly name = "google" as const;

  async busy(from: Date, to: Date): Promise<BusySlot[]> {
    const r = await googleFetch<{ calendars?: Record<string, { busy?: { start: string; end: string }[]; errors?: { reason: string }[] }> }>(`${BASE}/freeBusy`, {
      method: "POST",
      body: { timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: "primary" }] },
    });
    const primary = r.calendars?.primary;
    if (primary?.errors?.length) throw new Error(`Google Calendar free/busy: ${primary.errors.map((e) => e.reason).join(", ")}`);
    return (primary?.busy ?? []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
  }

  async createEvent(e: NewCalendarEvent): Promise<{ id: string; link: string | null }> {
    const r = await googleFetch<{ id: string; htmlLink?: string }>(`${BASE}/calendars/primary/events`, {
      method: "POST",
      body: {
        summary: e.title,
        location: e.location ?? undefined,
        description: e.description ?? undefined,
        start: { dateTime: localIso(e.start, e.timeZone), timeZone: e.timeZone },
        end: { dateTime: localIso(e.end, e.timeZone), timeZone: e.timeZone },
        reminders: { useDefault: true },
      },
    });
    return { id: r.id, link: r.htmlLink ?? null };
  }
}
