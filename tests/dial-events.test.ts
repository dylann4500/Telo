import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import type { VoiceProvider } from "../src/server/voice/provider";

// Replays the event order Dial actually sent on a live call: answered,
// hung up with transcriptAvailable=false, then call.transcribed a second
// later. The call must not be reviewed until the transcript is in.

const dir = mkdtempSync(path.join(os.tmpdir(), "telo-dial-"));
process.env.DATABASE_URL = `file:${path.join(dir, "telo.db")}`;
process.env.LLM_PROVIDER = "mock";
process.env.VOICE_PROVIDER = "mock";
process.env.MEMORY_PROVIDER = "local";

it("waits for the transcript of an answered call even when Dial says none is available", async () => {
  const { ensureDb, db } = await import("../src/server/db/client");
  await ensureDb();
  const schema = await import("../src/server/db/schema");
  const repo = await import("../src/server/tasks/repo");
  const transcript = [
    { speaker: "agent" as const, text: "Hi, this is Telo, an AI assistant calling for Dylan about a billing issue.", at: null },
    { speaker: "other" as const, text: "Comcast billing, this is Marcus. I've applied the $20 credit. Your confirmation number is C7714.", at: null },
  ];
  const fake: VoiceProvider = {
    name: "dial",
    placeCall: async () => ({ providerCallId: "pc_1", status: "queued" }),
    getCall: async () => ({ providerCallId: "pc_1", direction: "outbound", from: null, to: "+14155550142", status: "ended", endReason: "completed", durationSec: 156, transcript }),
    stopCall: async () => {},
    sendMessage: async () => ({ providerMessageId: null }),
    setInboundInstruction: async () => {},
  };
  (await import("../src/server/voice")).setVoiceForTests(fake);

  await db.insert(schema.tasks).values({ id: "tsk_t", userId: "usr_default", title: "Fix Comcast bill", request: "my bill is wrong", source: "web", status: "calling" });
  await db.insert(schema.calls).values({ id: "call_t", userId: "usr_default", taskId: "tsk_t", direction: "outbound", kind: "business", seq: 1, targetName: "Comcast", targetPhone: "+14155550142", purpose: "Fix the bill", status: "queued", providerCallId: "pc_1" });

  const { ingestVoiceEvent } = await import("../src/server/voice/ingest");
  const at = new Date();
  await ingestVoiceEvent({ kind: "call.status", providerCallId: "pc_1", direction: "outbound", from: null, to: null, status: "in_progress", at });
  await ingestVoiceEvent({ kind: "call.ended", providerCallId: "pc_1", direction: "outbound", from: null, to: null, endReason: "completed", durationSec: 156, transcriptAvailable: false, at });
  expect((await repo.getCall("call_t"))?.finishedAt).toBeNull(); // still waiting for the transcript
  expect((await repo.getTask("tsk_t"))?.status).toBe("calling");

  await ingestVoiceEvent({ kind: "call.transcribed", providerCallId: "pc_1" });
  const call = await repo.getCall("call_t");
  expect(call?.finishedAt).not.toBeNull();
  expect(call?.transcript).toHaveLength(2);
  const until = Date.now() + 5000;
  while (Date.now() < until && !(await repo.getCall("call_t"))?.analysis) await new Promise((r) => setTimeout(r, 50));
  expect((await repo.getCall("call_t"))?.analysis?.outcome).not.toBe("no_answer");
});
