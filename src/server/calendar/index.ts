import { config } from "../config";
import { localParts, zonedTime } from "../time";
import { GoogleCalendar } from "./google";
import { MockCalendar } from "./mock";
import type { BusySlot, CalendarProvider } from "./provider";

// Module-level (not globalThis) so code edits take effect on hot reload.
let instance: CalendarProvider | null | undefined;

/** The user's calendar, or null when it isn't connected. */
export function getCalendar(): CalendarProvider | null {
  if (instance !== undefined) return instance;
  instance = config.calendar.provider === "google" ? new GoogleCalendar() : config.calendar.provider === "mock" ? new MockCalendar() : null;
  return instance;
}

export function setCalendarForTests(c: CalendarProvider | null | undefined) {
  instance = c;
}

export interface FreeWindow {
  start: Date;
  end: Date;
}

// Hours a booking can reasonably go in. The model picks within these.
const DAY = { start: 9, end: 19 };

/** Free stretches of at least `minMinutes` inside daytime hours, from busy slots. */
export function freeWindows(busy: BusySlot[], from: Date, to: Date, tz: string, minMinutes = 30): FreeWindow[] {
  const out: FreeWindow[] = [];
  const first = localParts(from, tz);
  const sorted = [...busy].sort((a, b) => a.start.getTime() - b.start.getTime());
  for (let d = 0; d < 31; d++) {
    const dayStart = zonedTime(first.year, first.month, first.day + d, DAY.start, 0, tz);
    if (dayStart >= to) break;
    const dayEnd = zonedTime(first.year, first.month, first.day + d, DAY.end, 0, tz);
    let cursor = new Date(Math.max(dayStart.getTime(), from.getTime()));
    const end = new Date(Math.min(dayEnd.getTime(), to.getTime()));
    for (const b of sorted) {
      if (b.end <= cursor || b.start >= end) continue;
      if (b.start > cursor) out.push({ start: cursor, end: b.start });
      if (b.end > cursor) cursor = b.end;
    }
    if (end > cursor) out.push({ start: cursor, end });
  }
  return out.filter((w) => w.end.getTime() - w.start.getTime() >= minMinutes * 60_000);
}

function clock(d: Date, tz: string): string {
  const p = localParts(d, tz);
  const h = p.hour % 12 || 12;
  return `${h}${p.minute ? `:${String(p.minute).padStart(2, "0")}` : ""} ${p.hour < 12 ? "AM" : "PM"}`;
}

/** "Tue, Oct 13: 9 AM-12 PM, 2-7 PM; Wed, Oct 14: 9 AM-7 PM" */
export function describeWindows(windows: FreeWindow[], tz: string, maxDays = 7): string {
  const days = new Map<string, string[]>();
  for (const w of windows) {
    const label = w.start.toLocaleDateString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" });
    if (!days.has(label) && days.size >= maxDays) break;
    const list = days.get(label) ?? [];
    list.push(`${clock(w.start, tz)}-${clock(w.end, tz)}`);
    days.set(label, list);
  }
  return [...days.entries()].map(([day, list]) => `${day}: ${list.join(", ")}`).join("; ");
}

/** When the user is free over the next `days` days, as text for the model; null without a calendar. */
export async function userAvailability(tz: string, days = 7): Promise<string | null> {
  const cal = getCalendar();
  if (!cal) return null;
  try {
    const from = new Date();
    const to = new Date(from.getTime() + days * 86_400_000);
    const text = describeWindows(freeWindows(await cal.busy(from, to), from, to, tz), tz, days);
    return text || "No free time in the next week.";
  } catch (err) {
    console.warn("[calendar] free/busy failed", (err as Error).message);
    return null;
  }
}
