import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import type { LLM } from "../src/server/agent/llm";
import type { VoiceProvider } from "../src/server/voice/provider";

// With a real phone line, Telo must never dial a number the model came up
// with on its own: no directory entry and nothing the user typed means it asks.

const dir = mkdtempSync(path.join(os.tmpdir(), "telo-safety-"));
process.env.DATABASE_URL = `file:${path.join(dir, "telo.db")}`;
process.env.LLM_PROVIDER = "mock";
process.env.VOICE_PROVIDER = "mock";
process.env.MEMORY_PROVIDER = "local";
delete process.env.DEMO_TARGET_PHONE;

it("asks for a business's number instead of dialing one the model invented", async () => {
  const { ensureDb } = await import("../src/server/db/client");
  await ensureDb();
  const placed: string[] = [];
  const liveLine: VoiceProvider = {
    name: "dial",
    placeCall: async (input) => {
      placed.push(input.to);
      return { providerCallId: `p_${placed.length}`, status: "queued" };
    },
    getCall: async () => {
      throw new Error("not used");
    },
    stopCall: async () => {},
    sendMessage: async () => ({ providerMessageId: null }),
    setInboundInstruction: async () => {},
  };
  const { setVoiceForTests } = await import("../src/server/voice");
  setVoiceForTests(liveLine);

  const { MockLLM } = await import("../src/server/agent/mock-llm");
  const { setLLMForTests } = await import("../src/server/agent/llm");
  const base = new MockLLM();
  const hallucinating: LLM = {
    name: "mock",
    async structured(req) {
      const out = await base.structured(req);
      if (req.name === "understand-task") {
        const u = out as { targets: { phone: string | null }[] };
        u.targets = u.targets.map((t) => ({ ...t, phone: "+18005551234" })); // a number nobody gave
      }
      return out;
    },
  };
  setLLMForTests(hallucinating);

  const { handleWebMessage } = await import("../src/server/concierge");
  const repo = await import("../src/server/tasks/repo");
  await handleWebMessage("usr_default", "Cancel my gym membership at Equinox, email dylan@example.com");
  const [task] = await repo.listRecentTasks("usr_default", 1);
  expect(task.status).toBe("needs_info");
  const q = await repo.openQuestion(task.id);
  expect(q?.fields.map((f) => f.key)).toContain("phone_equinox");
  expect(task.targets[0].phone).toBeNull();
  expect(placed).toEqual([]);

  // Once the user gives the number, that's the one dialed.
  await handleWebMessage("usr_default", "It's 415-555-0142");
  await new Promise((r) => setTimeout(r, 300));
  expect(placed).toEqual(["+14155550142"]);
});
