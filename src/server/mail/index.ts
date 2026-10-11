import { config } from "../config";
import { GmailProvider } from "./gmail";
import { MockMail } from "./mock";
import type { MailProvider } from "./provider";

// Module-level (not globalThis) so code edits take effect on hot reload.
let instance: MailProvider | null | undefined;

/** The user's inbox, or null when email isn't connected. */
export function getMail(): MailProvider | null {
  if (instance !== undefined) return instance;
  instance = config.mail.provider === "gmail" ? new GmailProvider() : config.mail.provider === "mock" ? new MockMail() : null;
  return instance;
}

export function setMailForTests(m: MailProvider | null | undefined) {
  instance = m;
}
