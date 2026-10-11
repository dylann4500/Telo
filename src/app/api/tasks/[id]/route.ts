import { connection } from "next/server";
import { ensureDb } from "@/server/db/client";
import { buildTaskDetail } from "@/server/dto";

export async function GET(_req: Request, ctx: RouteContext<"/api/tasks/[id]">) {
  await connection();
  await ensureDb();
  const { id } = await ctx.params;
  const detail = await buildTaskDetail(id);
  if (!detail) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(detail);
}
