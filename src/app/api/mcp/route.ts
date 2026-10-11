import { and, desc, eq, inArray } from "drizzle-orm";
import { askTeloByVoice } from "@/server/concierge";
import { config } from "@/server/config";
import { db, ensureDb } from "@/server/db/client";
import { calls } from "@/server/db/schema";
import { patchTask, getUserByPhone } from "@/server/tasks/repo";
import { statusDigest } from "@/server/status";

// Telo's MCP server, registered with Dial as a "Context MCP". Dial's voice
// agent can call these tools during any call on the account, so every tool
// authorizes itself from Dial's per-call headers:
//   X-Dial-Direction: inbound | outbound
//   X-Dial-User-Number: the other party (the caller, or the business)
// Status and task tools only work when the line's owner is the one calling
// in; a business on an outbound call can only report call progress.
// Streamable HTTP transport, stateless, JSON responses only.

const TOOLS = [
  {
    name: "get_status",
    description: "Get the live status of everything Telo is handling for the caller. Use it when the line's owner asks how things are going.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "ask_telo",
    description:
      "Pass along what the line's owner just asked or said: a new request, an answer to a question Telo asked, a decision, or a question about past calls. Returns what to tell them.",
    inputSchema: {
      type: "object",
      properties: { message: { type: "string", description: "What the caller said, in their own words" } },
      required: ["message"],
      additionalProperties: false,
    },
  },
  {
    name: "report_progress",
    description:
      "While calling a business for a customer, report where the call is: reached a phone menu, put on hold, speaking with a person, or wrapping up.",
    inputSchema: {
      type: "object",
      properties: {
        stage: { type: "string", enum: ["phone_menu", "on_hold", "speaking_with_person", "wrapping_up"] },
        note: { type: "string" },
      },
      required: ["stage"],
      additionalProperties: false,
    },
  },
];

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

const ok = (id: Rpc["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });
const fail = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
const text = (t: string, isError = false) => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });

const STAGES: Record<string, string> = {
  phone_menu: "In the phone menu",
  on_hold: "On hold",
  speaking_with_person: "Talking to a person",
  wrapping_up: "Wrapping up",
};

async function callTool(name: string, args: Record<string, unknown>, headers: Headers) {
  const direction = headers.get("x-dial-direction");
  const other = headers.get("x-dial-user-number");
  if (name === "get_status" || name === "ask_telo") {
    const user = direction === "inbound" && other ? await getUserByPhone(other) : undefined;
    if (!user) return text("This tool is only available when the line's owner calls in.", true);
    if (name === "get_status") return text(await statusDigest(user.id));
    const message = typeof args.message === "string" ? args.message.trim() : "";
    if (!message) return text("Pass what the caller said in `message`.", true);
    return text(await askTeloByVoice(user, message));
  }
  if (name === "report_progress") {
    if (direction !== "outbound" || !other) return text("Only available during an outbound call.", true);
    const stage = STAGES[String(args.stage)] ?? "On the call";
    const note = typeof args.note === "string" ? args.note.slice(0, 120) : "";
    const digits = other.replace(/\D/g, "").slice(-10);
    const live = await db
      .select()
      .from(calls)
      .where(and(eq(calls.kind, "business"), inArray(calls.status, ["queued", "ringing", "in_progress"])))
      .orderBy(desc(calls.createdAt));
    const call = live.find((c) => c.targetPhone?.replace(/\D/g, "").slice(-10) === digits);
    if (!call) return text("No matching call.", true);
    const detail = note ? `${stage}: ${note}` : stage;
    await db.update(calls).set({ statusDetail: detail }).where(eq(calls.id, call.id));
    if (call.taskId) await patchTask(call.taskId, { statusDetail: `${call.targetName}: ${detail}` }, ["calling"]);
    return text("Noted.");
  }
  return text(`Unknown tool ${name}`, true);
}

async function handle(m: Rpc, headers: Headers) {
  if (m.id === undefined || m.id === null) return null; // a notification: nothing to return
  switch (m.method) {
    case "initialize":
      return ok(m.id, {
        protocolVersion: typeof m.params?.protocolVersion === "string" ? m.params.protocolVersion : "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "telo", version: "0.1.0" },
        instructions: "Telo's tools. get_status and ask_telo only work when the line's owner calls in. report_progress is for calls to businesses.",
      });
    case "ping":
      return ok(m.id, {});
    case "tools/list":
      return ok(m.id, { tools: TOOLS });
    case "tools/call": {
      const name = String(m.params?.name ?? "");
      const args = (m.params?.arguments as Record<string, unknown>) ?? {};
      try {
        return ok(m.id, await callTool(name, args, headers));
      } catch (err) {
        console.error("[mcp] tool failed", name, err);
        return ok(m.id, text("Telo couldn't do that right now. Say you'll text them shortly.", true));
      }
    }
    default:
      return fail(m.id, -32601, `Method not found: ${m.method}`);
  }
}

export async function POST(req: Request) {
  if (config.voice.mcpToken && req.headers.get("authorization") !== `Bearer ${config.voice.mcpToken}`) {
    return new Response("unauthorized", { status: 401 });
  }
  await ensureDb();
  let body: Rpc | Rpc[];
  try {
    body = await req.json();
  } catch {
    return Response.json(fail(null, -32700, "Parse error"), { status: 400 });
  }
  const batch = Array.isArray(body) ? body : [body];
  const results = (await Promise.all(batch.map((m) => handle(m, req.headers)))).filter(Boolean);
  if (!results.length) return new Response(null, { status: 202 });
  return Response.json(Array.isArray(body) ? results : results[0]);
}

export async function GET() {
  // No server-initiated stream: this server only answers requests.
  return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
}
