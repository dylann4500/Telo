import { newId } from "../ids";
import type { MailMessage, MailProvider } from "./provider";

// A local inbox for tests and offline demos: mail arrives through deliver()
// (the dashboard's dev tools, or a test) and is read like Gmail's.

const g = globalThis as unknown as { __teloMockInbox?: MailMessage[] };
const inbox = (g.__teloMockInbox ??= []);

export class MockMail implements MailProvider {
  readonly name = "mock" as const;

  async recent(days: number, max: number): Promise<string[]> {
    const since = Date.now() - days * 86_400_000;
    return inbox
      .filter((m) => m.receivedAt.getTime() >= since)
      .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())
      .slice(0, max)
      .map((m) => m.id);
  }

  async get(id: string): Promise<MailMessage> {
    const m = inbox.find((x) => x.id === id);
    if (!m) throw new Error(`mock email ${id} not found`);
    return m;
  }

  deliver(input: { from: string; fromName?: string | null; subject: string; text: string; receivedAt?: Date }): MailMessage {
    const m: MailMessage = { id: newId("mail"), from: input.from.toLowerCase(), fromName: input.fromName ?? null, subject: input.subject, text: input.text, receivedAt: input.receivedAt ?? new Date() };
    inbox.push(m);
    return m;
  }
}
