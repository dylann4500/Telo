import { DialClient, type Call } from "@getdial/sdk";
import { config } from "../config";
import type { CallStatus, TranscriptTurn } from "../domain/types";
import type { MessageChannel, PlaceCallInput, ProviderCallSnapshot, VoiceProvider } from "./provider";
import { sanitizeForSms } from "./provider";

// Dial (getdial.ai). See docs/integrations/dial.md for every field used here.

export const DIAL_API = "https://api.getdial.ai/api/v1";

export function mapDialState(state: string | undefined, terminationType?: string | null): CallStatus {
  switch (state) {
    case "Queued":
      return "queued";
    case "Ringing":
      return "ringing";
    case "In-Progress":
      return "in_progress";
    case "Terminated":
      return terminationType === "completed" ? "ended" : terminationType === "canceled" ? "canceled" : "failed";
    default:
      return "queued";
  }
}

type DialTurn = NonNullable<Call["transcriptTurns"]>[number];

export function mapTurns(turns: DialTurn[] | null | undefined): TranscriptTurn[] | null {
  if (!turns) return null;
  return turns.map((t) => ({ speaker: t.speaker === "agent" ? "agent" : "other", text: t.text, at: null }));
}

/** The SDK throws Error("Dial API error <status>: <json>") and never retries. */
export function parseDialError(err: unknown): { status: number; code?: string; message: string } | null {
  if (!(err instanceof Error)) return null;
  const m = /^Dial API error (\d+): ([\s\S]*)$/.exec(err.message);
  if (!m) return null;
  let body: { code?: string; error?: unknown } = {};
  try {
    body = JSON.parse(m[2]);
  } catch {
    /* not JSON */
  }
  return { status: Number(m[1]), code: body.code, message: typeof body.error === "string" ? body.error : m[2] };
}

export class DialVoice implements VoiceProvider {
  readonly name = "dial" as const;
  private client: DialClient;

  constructor() {
    if (!config.voice.dialApiKey) throw new Error("DIAL_API_KEY is not set");
    this.client = new DialClient({
      apiKey: config.voice.dialApiKey,
      baseUrl: config.voice.dialBaseUrl,
      userAgent: "telo/0.1",
    });
  }

  private numberId(): string {
    if (!config.voice.dialNumberId) throw new Error("DIAL_NUMBER_ID is not set (run npm run dial:setup)");
    return config.voice.dialNumberId;
  }

  async placeCall(input: PlaceCallInput) {
    const max = Math.max(60, Math.min(3600, input.maxDurationSec ?? config.voice.maxCallSeconds));
    const call = await this.client.makeCall({
      to: input.to,
      fromNumberId: this.numberId(),
      outboundInstruction: input.instructions,
      language: "en-US",
      voiceGender: "female",
      maxCallDurationSeconds: max,
      idempotencyKey: input.idempotencyKey,
    });
    return { providerCallId: call.id, status: mapDialState(call.status?.state, call.status?.terminationType) };
  }

  async getCall(providerCallId: string): Promise<ProviderCallSnapshot> {
    const call = await this.client.getCall(providerCallId);
    return {
      providerCallId: call.id,
      direction: call.direction === "inbound" ? "inbound" : "outbound",
      from: call.from ?? null,
      to: call.to ?? null,
      status: mapDialState(call.status?.state, call.status?.terminationType),
      endReason: call.status?.terminationType ?? null,
      durationSec: call.duration ?? null,
      transcript: mapTurns(call.transcriptTurns),
    };
  }

  async stopCall(providerCallId: string) {
    try {
      await this.client.stopCall(providerCallId);
    } catch (err) {
      // 400 = already ended, which is what we wanted.
      if (parseDialError(err)?.status !== 400) throw err;
    }
  }

  async sendMessage(input: { to: string; body: string; channel?: MessageChannel }) {
    const message = await this.client.sendMessage({
      to: input.to,
      fromNumberId: this.numberId(),
      body: sanitizeForSms(input.body),
      ...(input.channel && input.channel !== "sms" ? { channel: input.channel } : {}),
    });
    return { providerMessageId: message.id ?? null };
  }

  async setInboundInstruction(text: string) {
    await this.client.setNumberProperties(this.numberId(), { inboundInstruction: text });
  }
}
