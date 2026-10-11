import { after } from "next/server";
import { z } from "zod";
import { declineLive, decideLive, decideTask, handleWebMessage } from "@/server/concierge";
import { config } from "@/server/config";
import { db, ensureDb } from "@/server/db/client";
import { messages } from "@/server/db/schema";
import { newId } from "@/server/ids";
import { getTask, getUser, openLiveQuestion, openQuestion } from "@/server/tasks/repo";

const Body = z.object({ optionId: z.string().optional(), text: z.string().max(2000).optional(), decline: z.boolean().optional() });

/** A tap on an approval option, a typed answer, or "Not now" on a question asked mid-call, from the dashboard. */
export async function POST(req: Request, ctx: RouteContext<"/api/tasks/[id]/answer">) {
  await ensureDb();
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "bad request" }, { status: 400 });
  const task = await getTask(id);
  const user = await getUser(config.user.id);
  if (!task || !user || task.userId !== user.id) return Response.json({ error: "not found" }, { status: 404 });

  // A question Telo asked while a business waits on the line.
  const live = task.status === "calling" ? await openLiveQuestion(task.id) : undefined;
  if (parsed.data.decline && live) {
    await db.insert(messages).values({ id: newId("msg"), userId: user.id, taskId: task.id, direction: "in", channel: "web", kind: "decision", body: "Not now", status: "received" });
    return Response.json({ ok: await declineLive(task.id) });
  }
  if (parsed.data.optionId && live?.kind === "approval") {
    const option = live.options.find((o) => o.id === parsed.data.optionId);
    if (!option) return Response.json({ error: "unknown option" }, { status: 400 });
    await db.insert(messages).values({ id: newId("msg"), userId: user.id, taskId: task.id, direction: "in", channel: "web", kind: "decision", body: option.label, status: "received" });
    const declined = /^(no\b|don't|do not|skip|decline)/i.test(option.label);
    after(() => decideLive(user, task.id, option.id, !declined, null, "web").catch((err) => console.error(err)));
    return Response.json({ ok: true }, { status: 202 });
  }
  if (parsed.data.optionId && task.status === "needs_approval") {
    const q = await openQuestion(task.id);
    const option = q?.options.find((o) => o.id === parsed.data.optionId);
    if (!option) return Response.json({ error: "unknown option" }, { status: 400 });
    await db.insert(messages).values({ id: newId("msg"), userId: user.id, taskId: task.id, direction: "in", channel: "web", kind: "decision", body: option.label, status: "received" });
    const declined = /^(no\b|don't|do not|skip|decline)/i.test(option.label);
    after(() => decideTask(user, task.id, option.id, !declined, null).catch((err) => console.error(err)));
    return Response.json({ ok: true }, { status: 202 });
  }
  if (parsed.data.text?.trim()) {
    const text = parsed.data.text.trim();
    after(() => handleWebMessage(user.id, text).catch((err) => console.error(err)));
    return Response.json({ ok: true }, { status: 202 });
  }
  return Response.json({ error: "nothing to answer" }, { status: 400 });
}
