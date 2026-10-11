import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config";
import { nowContext } from "../time";

// A turn-by-turn stand-in for Dial's managed voice agent, for the lab: Claude
// plays the agent with exactly the brief Dial would get and Telo's mid-call
// tools (each tool call runs the real handler, as /api/mcp would), and Claude
// plays the business from a persona. Used by the simulated line when
// MOCK_AGENT=claude. Nothing is dialed.

const g = globalThis as unknown as { __teloSimTrace?: Map<string, SimTraceEntry[]> };
export interface SimTraceEntry {
  at: number;
  kind: "tool";
  name: string;
  input: unknown;
  result: string;
}
/** Tool calls made on each simulated call, for the lab's report. */
export const simTrace: Map<string, SimTraceEntry[]> = (g.__teloSimTrace ??= new Map());

const TOOL_NAMES = ["report_progress", "ask_customer", "wait_for_customer", "check_calendar"];

const AGENT_PREAMBLE = `You are the voice of a phone call that is happening right now. Everything you write as text is spoken out loud to the other person, so write only words you would say, with no stage directions, labels or notes. The other person's words arrive as lines starting with "THEM:". Your tools run while the line is quiet. When the call is over, say goodbye and call end_call.`;

const BUSINESS_SYSTEM = (persona: string) =>
  `You are on a phone call, playing this role: ${persona}
Reply with only your next spoken line: one or two short sentences, natural phone speech, no stage directions. You answered the phone, so your first line is a greeting. If the caller is quiet for a moment because they're checking something, wait patiently ("Sure, take your time."). When the conversation is clearly over, reply with exactly [HANGUP].`;

export async function playLiveCall(input: {
  callId: string | undefined;
  to: string | null;
  instructions: string;
  persona: string;
  say: (speaker: "agent" | "other", text: string) => Promise<boolean>;
}): Promise<void> {
  const client = new Anthropic();
  const { callTool, TOOLS } = await import("../live-call");
  const agentModel = process.env.SIM_AGENT_MODEL ?? config.llm.fastModel;
  const tools: Anthropic.Tool[] = [
    ...TOOLS.filter((t) => TOOL_NAMES.includes(t.name)).map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema as unknown as Anthropic.Tool.InputSchema })),
    { name: "end_call", description: "Hang up. Use it once you've said goodbye.", input_schema: { type: "object", properties: {} } },
  ];
  const system = `${AGENT_PREAMBLE}\n\nIt is ${nowContext(config.user.timezone)}.\n\n${input.instructions}`;
  const messages: Anthropic.MessageParam[] = [];
  const transcript: string[] = [];
  const trace: SimTraceEntry[] = [];
  if (input.callId) simTrace.set(input.callId, trace);

  const business = async (): Promise<string> => {
    const r = await client.messages.create({
      model: config.llm.fastModel,
      max_tokens: 2000,
      system: BUSINESS_SYSTEM(input.persona),
      messages: [{ role: "user", content: transcript.length ? `The call so far:\n${transcript.join("\n")}\n\nYour next line:` : "The phone rings and you pick up. Your first line:" }],
    });
    const text = r.content.filter((b) => b.type === "text").map((b) => (b as Anthropic.TextBlock).text).join(" ").trim();
    if (process.env.SIM_DEBUG) console.log(`[sim] business (${r.stop_reason}):`, JSON.stringify(text));
    return text;
  };

  // Their words go in as a user turn (after tool results, in the same one).
  const heard = (text: string) => {
    const last = messages.at(-1);
    if (last?.role === "user" && Array.isArray(last.content)) last.content.push({ type: "text", text });
    else messages.push({ role: "user", content: [{ type: "text", text }] });
  };

  for (let turn = 0; turn < 30; turn++) {
    const line = await business();
    if (!line || /\[HANGUP\]/.test(line)) {
      const words = line.replace("[HANGUP]", "").trim();
      if (words) await input.say("other", words);
      return;
    }
    if (!(await input.say("other", line))) return;
    transcript.push(`THEM: ${line}`);
    heard(`THEM: ${line}`);

    // The agent's turn: it may speak, call tools, speak again, until it waits for them.
    let saidSomething = false;
    let nudged = false;
    for (let step = 0; step < 24; step++) {
      const r = await client.messages.create({ model: agentModel, max_tokens: 2500, system, messages, tools });
      messages.push({ role: "assistant", content: r.content });
      const spoken = r.content.filter((b) => b.type === "text").map((b) => (b as Anthropic.TextBlock).text).join(" ").trim();
      if (spoken) {
        if (!(await input.say("agent", spoken))) return;
        transcript.push(`TELO: ${spoken}`);
        saidSomething = true;
      }
      const uses = r.content.filter((b) => b.type === "tool_use") as Anthropic.ToolUseBlock[];
      if (!uses.length) {
        // A live line doesn't wait: silence after a tool call is dead air. Nudge once, as a real pause would.
        if (!saidSomething && !nudged) {
          nudged = true;
          heard("(The line is quiet. They're waiting for you to say something.)");
          continue;
        }
        break;
      }
      const results: Anthropic.ToolResultBlockParam[] = [];
      let hangUp = false;
      for (const u of uses) {
        if (u.name === "end_call") {
          hangUp = true;
          results.push({ type: "tool_result", tool_use_id: u.id, content: "Call ended." });
          continue;
        }
        const out = await callTool(u.name, (u.input ?? {}) as Record<string, unknown>, { direction: "outbound", other: input.to, callId: input.callId });
        trace.push({ at: Date.now(), kind: "tool", name: u.name, input: u.input, result: out.text });
        results.push({ type: "tool_result", tool_use_id: u.id, content: out.text, ...(out.isError ? { is_error: true } : {}) });
      }
      messages.push({ role: "user", content: results });
      if (hangUp) return;
    }
  }
}
