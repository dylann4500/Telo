import { after } from "next/server";
import { processWebhookReceipt } from "@/server/background";
import { config } from "@/server/config";
import { db, ensureDb } from "@/server/db/client";
import { webhookReceipts } from "@/server/db/schema";
import { verifyDialSignature } from "@/server/voice/dial-webhook";

// Dial's account webhook. Verify the signature on the raw body, store the
// event under Dial's event id (a retried delivery is a no-op), acknowledge
// within Dial's 10 s window, then process after responding.

export async function POST(req: Request) {
  const raw = await req.text();
  const secret = config.voice.dialWebhookSecret;
  if (!secret) return new Response("DIAL_WEBHOOK_SECRET is not configured", { status: 503 });
  if (!verifyDialSignature(secret, req.headers.get("x-dial-signature"), raw)) {
    return new Response("invalid signature", { status: 401 });
  }
  let envelope: { id?: string; type?: string };
  try {
    envelope = JSON.parse(raw);
  } catch {
    return new Response("invalid JSON", { status: 400 });
  }
  const eventId = req.headers.get("x-dial-event-id") ?? envelope.id;
  if (!eventId || typeof envelope.type !== "string") return new Response("missing event id or type", { status: 400 });

  await ensureDb();
  const id = `dial:${eventId}`;
  const inserted = await db
    .insert(webhookReceipts)
    .values({ id, provider: "dial", type: envelope.type, payload: envelope, status: "received", receivedAt: new Date() })
    .onConflictDoNothing()
    .returning();
  if (!inserted.length) return Response.json({ ok: true, duplicate: true });

  after(() => processWebhookReceipt(id));
  return Response.json({ ok: true });
}
