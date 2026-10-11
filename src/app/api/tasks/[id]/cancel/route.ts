import { ensureDb } from "@/server/db/client";
import { notify } from "@/server/notify";
import { cancelTask } from "@/server/orchestrator";
import { getTask } from "@/server/tasks/repo";

export async function POST(_req: Request, ctx: RouteContext<"/api/tasks/[id]/cancel">) {
  await ensureDb();
  const { id } = await ctx.params;
  const task = await getTask(id);
  if (!task) return Response.json({ error: "not found" }, { status: 404 });
  const ok = await cancelTask(id, "Cancelled from the dashboard.");
  if (ok) await notify({ userId: task.userId, taskId: id, kind: "reply", body: `Stopped "${task.title}".`, channel: "web" });
  return Response.json({ ok });
}
