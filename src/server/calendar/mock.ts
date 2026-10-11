import { newId } from "../ids";
import type { BusySlot, CalendarProvider, NewCalendarEvent } from "./provider";

// An in-memory calendar for tests and offline demos.

const g = globalThis as unknown as { __teloMockCalendar?: { busy: BusySlot[]; created: (NewCalendarEvent & { id: string })[] } };
const store = (g.__teloMockCalendar ??= { busy: [], created: [] });

export class MockCalendar implements CalendarProvider {
  readonly name = "mock" as const;

  async busy(from: Date, to: Date): Promise<BusySlot[]> {
    return [...store.busy, ...store.created].filter((b) => b.start < to && b.end > from).map((b) => ({ start: b.start, end: b.end }));
  }

  async createEvent(e: NewCalendarEvent) {
    const id = newId("cal");
    store.created.push({ ...e, id });
    return { id, link: null };
  }

  /** Tests: mark time as busy. */
  addBusy(start: Date, end: Date) {
    store.busy.push({ start, end });
  }

  get created() {
    return store.created;
  }
}
