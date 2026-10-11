import { ensureDb } from "@/server/db/client";
import { notify } from "@/server/notify";
import { wakeTask } from "@/server/orchestrator";
import { getTask } from "@/server/tasks/repo";

/** "Call now" for a task Telo scheduled for later. */
export async function POST(_req: Request, ctx: RouteContext<"/api/tasks/[id]/wake">) {
  await ensureDb();
  const { id } = await ctx.params;
  const task = await getTask(id);
  if (!task) return Response.json({ error: "not found" }, { status: 404 });
  const ok = await wakeTask(id);
  const who = task.followUp?.callback?.targetName ?? task.targets[0]?.name ?? "them";
  if (ok) await notify({ userId: task.userId, taskId: id, kind: "reply", body: `Calling ${who} now.`, channel: "web" });
  return Response.json({ ok });
}
