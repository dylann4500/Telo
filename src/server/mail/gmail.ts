import { googleFetch } from "../google/auth";
import type { MailMessage, MailProvider } from "./provider";

// Gmail through its REST API with the gmail.readonly scope: list and read,
// nothing else. Promotions, social and forum mail are skipped at the query;
// receipts and confirmations usually land in Primary or Updates.

const BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const QUERY = "in:inbox -category:promotions -category:social -category:forums";

interface GmailPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
  headers?: { name: string; value: string }[];
}

interface GmailMessage {
  id: string;
  internalDate?: string;
  snippet?: string;
  payload?: GmailPart;
}

const decode = (data: string) => Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

function findPart(part: GmailPart | undefined, mime: string): GmailPart | undefined {
  if (!part) return undefined;
  if (part.mimeType === mime && part.body?.data) return part;
  for (const p of part.parts ?? []) {
    const hit = findPart(p, mime);
    if (hit) return hit;
  }
  return undefined;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/div|\/tr|\/li|\/h\d)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

export function parseFrom(header: string): { address: string; name: string | null } {
  const m = header.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { address: m[2].trim().toLowerCase(), name: m[1].trim() || null };
  return { address: header.trim().toLowerCase(), name: null };
}

export class GmailProvider implements MailProvider {
  readonly name = "gmail" as const;

  async recent(days: number, max: number): Promise<string[]> {
    const q = `${QUERY} newer_than:${Math.max(1, Math.round(days))}d`;
    const r = await googleFetch<{ messages?: { id: string }[] }>(`${BASE}/messages?maxResults=${max}&q=${encodeURIComponent(q)}`);
    return (r.messages ?? []).map((m) => m.id);
  }

  async get(id: string): Promise<MailMessage> {
    const m = await googleFetch<GmailMessage>(`${BASE}/messages/${encodeURIComponent(id)}?format=full`);
    const header = (name: string) => m.payload?.headers?.find((h) => h.name.toLowerCase() === name)?.value ?? "";
    const { address, name } = parseFrom(header("from"));
    const plain = findPart(m.payload, "text/plain");
    const html = findPart(m.payload, "text/html");
    const text = plain?.body?.data ? decode(plain.body.data) : html?.body?.data ? htmlToText(decode(html.body.data)) : m.payload?.body?.data ? decode(m.payload.body.data) : m.snippet ?? "";
    return {
      id: m.id,
      from: address,
      fromName: name,
      subject: header("subject"),
      receivedAt: new Date(Number(m.internalDate ?? Date.now())),
      text: text.replace(/\s+\n/g, "\n").trim().slice(0, 8000),
    };
  }

  /** The connected account's address. */
  async account(): Promise<string> {
    const p = await googleFetch<{ emailAddress: string }>(`${BASE}/profile`);
    return p.emailAddress;
  }
}
