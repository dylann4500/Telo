// The user's calendar: free/busy to suggest times (Telo never sees what the
// busy events are), and new events for bookings Telo makes.

export interface BusySlot {
  start: Date;
  end: Date;
}

export interface NewCalendarEvent {
  title: string;
  start: Date;
  end: Date;
  timeZone: string;
  location?: string | null;
  description?: string | null;
}

export interface CalendarProvider {
  readonly name: "google" | "mock";
  busy(from: Date, to: Date): Promise<BusySlot[]>;
  createEvent(e: NewCalendarEvent): Promise<{ id: string; link: string | null }>;
  /** Moves or renames an event Telo created. */
  updateEvent(id: string, patch: { start?: Date; end?: Date; timeZone: string; title?: string; description?: string }): Promise<void>;
}
