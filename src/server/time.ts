// Time in the user's timezone, without a date library: local ISO strings for
// the model, the calling-hours window for scheduled calls, and short labels.

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0 = Sunday
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Telo never starts a call to a business outside these local hours. Which
// day and time suits a particular business is the model's call; this is
// only the backstop against a 3 AM dial.
export const CALLING_HOURS = { start: 8, end: 21 };
const DEFAULT_HOUR = 10;

export function localParts(date: Date, tz: string): Parts {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour) % 24,
    minute: Number(p.minute),
    weekday: WEEKDAYS.indexOf(String(p.weekday)),
  };
}

/** Minutes the timezone is ahead of UTC at this instant (e.g. -420 for PDT). */
function offsetMinutes(date: Date, tz: string): number {
  const p = localParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return Math.round((asUtc - Math.floor(date.getTime() / 60_000) * 60_000) / 60_000);
}

/** The instant when the wall clock in `tz` shows this local time. */
export function zonedTime(year: number, month: number, day: number, hour: number, minute: number, tz: string): Date {
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  for (let i = 0; i < 2; i++) guess = new Date(Date.UTC(year, month - 1, day, hour, minute) - offsetMinutes(guess, tz) * 60_000);
  return guess;
}

/** "2026-10-10T19:05:00-07:00" */
export function localIso(date: Date, tz: string): string {
  const p = localParts(date, tz);
  const off = offsetMinutes(date, tz);
  const sign = off < 0 ? "-" : "+";
  const abs = Math.abs(off);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** What the model gets as "now": a local ISO time plus the readable day. */
export function nowContext(tz: string, date = new Date()): string {
  const readable = date.toLocaleString("en-US", { timeZone: tz, dateStyle: "full", timeStyle: "short" });
  return `${localIso(date, tz)} (${readable}, ${tz})`;
}

/** 10:00 local on the day after `date`. */
function nextMorning(date: Date, tz: string): Date {
  const p = localParts(new Date(date.getTime() + 24 * 3600_000), tz);
  return zonedTime(p.year, p.month, p.day, DEFAULT_HOUR, 0, tz);
}

export function withinCallingHours(date: Date, tz: string): boolean {
  const { hour } = localParts(date, tz);
  return hour >= CALLING_HOURS.start && hour < CALLING_HOURS.end;
}

/** Moves a time into calling hours: too early becomes 10:00 that day, too late 10:00 the next. */
export function clampToCallingHours(date: Date, tz: string): Date {
  if (withinCallingHours(date, tz)) return date;
  const p = localParts(date, tz);
  return p.hour < CALLING_HOURS.start ? zonedTime(p.year, p.month, p.day, DEFAULT_HOUR, 0, tz) : nextMorning(date, tz);
}

/** 10:00 on the next weekday: the default when a later call has no time attached. */
export function nextWeekdayMorning(tz: string, from = new Date()): Date {
  let d = nextMorning(from, tz);
  while ([0, 6].includes(localParts(d, tz).weekday)) d = nextMorning(d, tz);
  return d;
}

/**
 * "today at 3:30 PM", "tomorrow at 10:00 AM" or "Tue, Oct 13 at 10:00 AM".
 * `absolute` always names the day, for text that is read later.
 */
export function formatWhen(date: Date, tz: string, opts: { now?: Date; absolute?: boolean } = {}): string {
  const now = opts.now ?? new Date();
  const time = date.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  const dayKey = (d: Date) => {
    const p = localParts(d, tz);
    return `${p.year}-${p.month}-${p.day}`;
  };
  if (!opts.absolute) {
    if (dayKey(date) === dayKey(now)) return `today at ${time}`;
    if (dayKey(date) === dayKey(new Date(now.getTime() + 24 * 3600_000))) return `tomorrow at ${time}`;
  }
  return `${date.toLocaleDateString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" })} at ${time}`;
}
