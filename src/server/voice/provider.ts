import type { CallStatus, TranscriptTurn } from "../domain/types";

// Telo's only dependency on a telephony provider. Dial is the real one; the
// mock plays out simulated calls through the same event pipeline.

export interface PlaceCallInput {
  callId: string;
  to: string; // E.164
  instructions: string;
  idempotencyKey: string;
  maxDurationSec?: number;
}

export interface ProviderCallSnapshot {
  providerCallId: string;
  direction: "inbound" | "outbound";
  from: string | null;
  to: string | null;
  status: CallStatus;
  endReason: string | null; // completed | busy | no-answer | failed | canceled
  durationSec: number | null;
  transcript: TranscriptTurn[] | null;
}

export type MessageChannel = "sms" | "imessage" | "whatsapp";

export interface VoiceProvider {
  readonly name: "dial" | "mock";
  placeCall(input: PlaceCallInput): Promise<{ providerCallId: string; status: CallStatus }>;
  getCall(providerCallId: string): Promise<ProviderCallSnapshot>;
  stopCall(providerCallId: string): Promise<void>;
  sendMessage(input: { to: string; body: string; channel?: MessageChannel }): Promise<{ providerMessageId: string | null }>;
  /** The system prompt Dial's agent uses when someone calls Telo's number. */
  setInboundInstruction(text: string): Promise<void>;
}

/** Provider-neutral events. Dial webhooks and the mock simulator both produce these. */
export type VoiceEvent =
  | {
      kind: "call.status";
      providerCallId: string;
      direction: "inbound" | "outbound";
      from: string | null;
      to: string | null;
      status: CallStatus;
      at: Date;
    }
  | {
      kind: "call.ended";
      providerCallId: string;
      direction: "inbound" | "outbound";
      from: string | null;
      to: string | null;
      endReason: string | null;
      durationSec: number | null;
      transcriptAvailable: boolean;
      at: Date;
    }
  | { kind: "call.transcribed"; providerCallId: string }
  | { kind: "call.transcript_partial"; providerCallId: string; turns: TranscriptTurn[] }
  | { kind: "message.received"; providerMessageId: string; from: string; to: string | null; body: string; channel: string }
  | { kind: "message.status"; providerMessageId: string; deliveryState: string; error: string | null };

/** SMS on a standard number allows 670 characters once any non-GSM character appears; keep text plain. */
export function sanitizeForSms(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/•/g, "*")
    .slice(0, 600);
}
