import { connection } from "next/server";
import { config } from "@/server/config";
import { ensureDb } from "@/server/db/client";
import { buildState } from "@/server/dto";

export async function GET() {
  await connection();
  await ensureDb();
  return Response.json(await buildState(config.user.id));
}
