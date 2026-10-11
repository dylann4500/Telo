// Telo's view of the user's inbox: read-only. Gmail in production; a local
// inbox for tests and demos.

export interface MailMessage {
  id: string; // the provider's message id
  from: string; // address
  fromName: string | null;
  subject: string;
  receivedAt: Date;
  text: string; // plain-text body, trimmed
}

export interface MailProvider {
  readonly name: "gmail" | "mock";
  /** Inbox message ids from the last `days` days, newest first. */
  recent(days: number, max: number): Promise<string[]>;
  get(id: string): Promise<MailMessage>;
}

export function domainOf(address: string): string {
  return address.split("@")[1]?.toLowerCase() ?? "";
}
