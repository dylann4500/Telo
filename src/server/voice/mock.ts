import { config } from "../config";
import type { CallStatus, TranscriptTurn } from "../domain/types";
import type { PlaceCallInput, ProviderCallSnapshot, VoiceEvent, VoiceProvider } from "./provider";
import { scenarioFor, type SimTurn } from "./mock-scenarios";

// A simulated phone line for development and offline demos. Calls play out
// over a few seconds and emit the same provider-neutral events as Dial's
// webhooks, so the orchestrator can't tell the difference. Unlike Dial, the
// mock streams the transcript while the call is live.

interface SimCall {
  snapshot: ProviderCallSnapshot;
  cancelled: boolean;
  callId?: string; // Telo's call id, so the line's tool calls find the call the way Dial's headers would
}

const g = globalThis as unknown as { __teloMockCalls?: Map<string, SimCall>; __teloMockInbound?: string; __teloMockCounts?: Map<string, number> };
const calls = (g.__teloMockCalls ??= new Map());
const callCounts = (g.__teloMockCounts ??= new Map()); // calls each business has received

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms / Math.max(0.1, config.demo.mockSpeed)));

async function emit(event: VoiceEvent) {
  const { ingestVoiceEvent } = await import("./ingest");
  await ingestVoiceEvent(event);
}

async function scriptFor(business: string, instructions: string): Promise<SimTurn[] | "no_answer" | { live: string }> {
  const scenario = scenarioFor(business);
  const callNumber = (callCounts.get(business.toLowerCase()) ?? 0) + 1;
  callCounts.set(business.toLowerCase(), callNumber);
  const persona = typeof scenario.persona === "function" ? scenario.persona(callNumber) : scenario.persona;
  if (persona === null) return "no_answer";
  if (Array.isArray(persona)) return persona;
  // The call lab: Claude plays Dial's agent turn by turn, with Telo's real mid-call tools.
  if (process.env.MOCK_AGENT === "claude" && config.llm.provider === "anthropic") return { live: persona };
  if (config.llm.provider === "anthropic") {
    try {
      const { simulateCall } = await import("../agent");
      const sim = await simulateCall({ business, instructions, scenario: persona });
      if (sim.outcome !== "answered") return "no_answer";
      if (sim.turns.length) return sim.turns;
    } catch (err) {
      console.warn("[mock] role-play failed, using the canned script", err);
    }
  }
  return scenario.script({ user: config.user.name, business, instructions, callNumber });
}

function businessFrom(instructions: string): string {
  return instructions.match(/making a phone call to (.+?) on behalf of/)?.[1] ?? "the business";
}

export class MockVoice implements VoiceProvider {
  readonly name = "mock" as const;

  async placeCall(input: PlaceCallInput) {
    const providerCallId = `mock_${input.callId}`;
    if (!calls.has(providerCallId)) {
      calls.set(providerCallId, {
        cancelled: false,
        callId: input.callId,
        snapshot: {
          providerCallId,
          direction: "outbound",
          from: config.voice.teloPhone,
          to: input.to,
          status: "queued",
          endReason: null,
          durationSec: null,
          transcript: null,
        },
      });
      void this.play(providerCallId, input.instructions).catch((err) => console.error("[mock] call failed", err));
    }
    return { providerCallId, status: "queued" as CallStatus };
  }

  private async play(providerCallId: string, instructions: string) {
    const sim = calls.get(providerCallId)!;
    const base = { providerCallId, direction: "outbound" as const, from: sim.snapshot.from, to: sim.snapshot.to };
    const setStatus = async (status: CallStatus) => {
      sim.snapshot.status = status;
      await emit({ kind: "call.status", ...base, status, at: new Date() });
    };
    const script = await scriptFor(businessFrom(instructions), instructions);
    await sleep(700);
    if (sim.cancelled) return;
    await setStatus("ringing");
    await sleep(2200);
    if (sim.cancelled) return;
    if (script === "no_answer") {
      sim.snapshot.status = "failed";
      sim.snapshot.endReason = "no-answer";
      await emit({ kind: "call.ended", ...base, endReason: "no-answer", durationSec: null, transcriptAvailable: false, at: new Date() });
      return;
    }
    await setStatus("in_progress");
    const started = Date.now();
    const turns: TranscriptTurn[] = [];
    const say = async (speaker: SimTurn["speaker"], text: string) => {
      await sleep(900 + Math.min(4000, text.length * 28));
      if (sim.cancelled) return false;
      turns.push({ speaker, text, at: new Date().toISOString() });
      sim.snapshot.transcript = [...turns];
      await emit({ kind: "call.transcript_partial", providerCallId, turns: [...turns] });
      return true;
    };
    if (!Array.isArray(script)) {
      const { playLiveCall } = await import("./sim-agent");
      try {
        await playLiveCall({ callId: sim.callId, to: sim.snapshot.to, instructions, persona: script.live, say });
      } catch (err) {
        console.error("[mock] live call failed", err);
      }
      if (sim.cancelled) return;
    }
    // What the last mid-call tool brought back (an answer from the user, a free slot).
    let answer: string | null = null;
    let answered = true;
    for (const turn of Array.isArray(script) ? script : []) {
      if (turn.tool) {
        if (turn.text && !(await say("agent", turn.text))) return;
        const { callTool } = await import("../live-call");
        const headers = { direction: "outbound", other: sim.snapshot.to, callId: sim.callId };
        let r = await callTool(turn.tool.name, turn.tool.args ?? {}, headers);
        while (/^wait_for_(answer|customer)$/.test(turn.tool.name) && r.data?.status === "waiting") {
          // Say what the tool says to say while waiting, as Dial's agent would.
          if (!(await say("agent", r.text.match(/Say: "([^"]+)"/)?.[1] ?? "Thanks for bearing with me, still checking."))) return;
          r = await callTool(turn.tool.name, {}, headers);
        }
        const status = String(r.data?.status ?? "");
        answered = ["answered", "known", "free", "asked"].includes(status);
        answer = (r.data?.value ?? r.data?.choice ?? r.data?.startsAt ?? null) as string | null;
        continue;
      }
      const text = !answered && turn.orElse ? turn.orElse : turn.text.replace("{answer}", answer ?? "");
      if (!(await say(turn.speaker, text))) return;
    }
    await sleep(800);
    sim.snapshot.status = "ended";
    sim.snapshot.endReason = "completed";
    sim.snapshot.durationSec = Math.round(((Date.now() - started) / 1000) * Math.max(1, config.demo.mockSpeed) * 4);
    await emit({ kind: "call.ended", ...base, endReason: "completed", durationSec: sim.snapshot.durationSec, transcriptAvailable: true, at: new Date() });
    await sleep(600);
    await emit({ kind: "call.transcribed", providerCallId });
  }

  async getCall(providerCallId: string): Promise<ProviderCallSnapshot> {
    const sim = calls.get(providerCallId);
    if (!sim) throw new Error(`mock call ${providerCallId} not found`);
    return { ...sim.snapshot, transcript: sim.snapshot.transcript ? [...sim.snapshot.transcript] : null };
  }

  async stopCall(providerCallId: string) {
    const sim = calls.get(providerCallId);
    if (!sim || sim.cancelled) return;
    sim.cancelled = true;
    sim.snapshot.status = "canceled";
    sim.snapshot.endReason = "canceled";
    await emit({
      kind: "call.ended",
      providerCallId,
      direction: "outbound",
      from: sim.snapshot.from,
      to: sim.snapshot.to,
      endReason: "canceled",
      durationSec: null,
      transcriptAvailable: false,
      at: new Date(),
    });
  }

  async sendMessage() {
    // The dashboard thread is the delivery channel in mock mode.
    return { providerMessageId: null };
  }

  async setInboundInstruction(text: string) {
    g.__teloMockInbound = text;
  }

  /** Dev tool: pretend the user called Telo's number and said these things. */
  async simulateInboundCall(from: string, userLines: string[], agentLines: string[] = []) {
    const providerCallId = `mock_in_${Date.now().toString(36)}`;
    const transcript: TranscriptTurn[] = [];
    userLines.forEach((line, i) => {
      if (agentLines[i]) transcript.push({ speaker: "agent", text: agentLines[i], at: null });
      transcript.push({ speaker: "other", text: line, at: null });
    });
    calls.set(providerCallId, {
      cancelled: false,
      snapshot: { providerCallId, direction: "inbound", from, to: config.voice.teloPhone, status: "in_progress", endReason: null, durationSec: null, transcript: null },
    });
    const base = { providerCallId, direction: "inbound" as const, from, to: config.voice.teloPhone };
    await emit({ kind: "call.status", ...base, status: "in_progress", at: new Date() });
    const sim = calls.get(providerCallId)!;
    sim.snapshot.transcript = transcript;
    sim.snapshot.status = "ended";
    sim.snapshot.endReason = "completed";
    sim.snapshot.durationSec = 20 + transcript.length * 6;
    await emit({ kind: "call.ended", ...base, endReason: "completed", durationSec: sim.snapshot.durationSec, transcriptAvailable: true, at: new Date() });
    await emit({ kind: "call.transcribed", providerCallId });
    return providerCallId;
  }
}
