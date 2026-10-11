import { createHmac, timingSafeEqual } from "node:crypto";
import type { VoiceEvent } from "./provider";
import { mapDialState } from "./dial";

// Dial webhook verification and normalization. Signature scheme (from Dial's
// docs and SDK): X-Dial-Signature: t=<unix>,v1=<hex>, where v1 is
// HMAC-SHA256(secret, `${t}.${rawBody}`) with the whsec_ secret used verbatim.

export function verifyDialSignature(secret: string, header: string | null, rawBody: string, toleranceSec = 300, nowSec = Math.floor(Date.now() / 1000)): boolean {
  if (!header || !secret) return false;
  let t: number | undefined;
  let v1: string | undefined;
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "t") t = Number(v);
    else if (k === "v1") v1 = v;
  }
  if (t === undefined || !Number.isFinite(t) || !v1 || !/^[0-9a-f]+$/.test(v1)) return false;
  if (Math.abs(nowSec - t) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return expected.length === v1.length && timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(v1, "hex"));
}

export function signDialPayload(secret: string, rawBody: string, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex")}`;
}

interface DialEnvelope {
  id: string;
  type: string;
  version?: number;
  createdAt?: string;
  data?: Record<string, unknown>;
}

const str = (v: unknown) => (typeof v === "string" ? v : null);

/** Maps one Dial event envelope to Telo's provider-neutral events. Unknown types map to []. */
export function normalizeDialEvent(envelope: DialEnvelope): VoiceEvent[] {
  const d = envelope.data ?? {};
  const at = envelope.createdAt ? new Date(envelope.createdAt) : new Date();
  switch (envelope.type) {
    case "call.status_changed": {
      const status = d.status as { state?: string } | undefined;
      return [
        {
          kind: "call.status",
          providerCallId: String(d.callId),
          direction: d.direction === "inbound" ? "inbound" : "outbound",
          from: str(d.from),
          to: str(d.to),
          status: mapDialState(status?.state, str(d.terminationType)),
          at,
        },
      ];
    }
    case "call.ended":
      return [
        {
          kind: "call.ended",
          providerCallId: String(d.callId),
          direction: d.direction === "inbound" ? "inbound" : "outbound",
          from: str(d.from),
          to: str(d.to),
          endReason: str(d.status),
          durationSec: typeof d.durationSeconds === "number" ? d.durationSeconds : null,
          transcriptAvailable: Boolean(d.transcriptAvailable),
          at,
        },
      ];
    case "call.transcribed":
      return [{ kind: "call.transcribed", providerCallId: String(d.callId) }];
    case "message.received":
      if (d.source === "internal") return []; // dashboard test traffic
      return [
        {
          kind: "message.received",
          providerMessageId: String(d.messageId),
          from: String(d.from),
          to: str(d.to),
          body: typeof d.body === "string" ? d.body : "",
          channel: str(d.channel) ?? "sms",
          // Photos (MMS): Dial's inbound media URLs are public. Only the count goes to Keewano.
          media: Array.isArray(d.media) ? (d.media as { url?: unknown }[]).map((m) => (typeof m?.url === "string" ? m.url : "")).filter(Boolean) : [],
        },
      ];
    case "message.status_changed":
      return [
        {
          kind: "message.status",
          providerMessageId: String(d.messageId),
          deliveryState: str(d.deliveryState) ?? "unknown",
          error: str(d.deliveryError),
        },
      ];
    default:
      return []; // webhook.ping, number.status_changed, future types
  }
}
