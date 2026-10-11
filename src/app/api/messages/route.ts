import { after } from "next/server";
import { z } from "zod";
import { handleWebMessage } from "@/server/concierge";
import { config } from "@/server/config";
import { ensureDb } from "@/server/db/client";

const Body = z.object({ text: z.string().min(1).max(2000) });

/** The dashboard's chat box: same pipeline as a text to Telo's number. */
export async function POST(req: Request) {
  await ensureDb();
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "text is required" }, { status: 400 });
  const text = parsed.data.text.trim();
  after(() => handleWebMessage(config.user.id, text).catch((err) => console.error("[messages]", err)));
  return Response.json({ ok: true }, { status: 202 });
}
