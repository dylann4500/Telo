import { z } from "zod";
import { setCallUpdates } from "@/server/concierge";
import { config } from "@/server/config";
import { ensureDb } from "@/server/db/client";

const Body = z.object({ callUpdates: z.boolean() });

/** The dashboard's "Text me / Text + call me" toggle (texting Telo "just text me" does the same). */
export async function POST(req: Request) {
  await ensureDb();
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "callUpdates (boolean) is required" }, { status: 400 });
  await setCallUpdates(config.user.id, parsed.data.callUpdates, "dashboard");
  return Response.json({ ok: true });
}
