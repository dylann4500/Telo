import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });

// npm run keewano:check: proves the Keewano setup end to end.
//   1. registers Telo's event catalog (idempotent)
//   2. writes one test event to a throwaway entity
//   3. runs live SQL: the project's event count, and Telo's relationship streams
// New events take ~5 minutes to become queryable, so step 3 may not see step 2 yet.

async function main() {
  const { KeewanoMemory, catalogHash, entityUuid } = await import("../src/server/memory/keewano");
  const memory = new KeewanoMemory();
  const missing = ["KEEWANO_API_KEY", "KEEWANO_PAT", "KEEWANO_PROJECT_ID", "KEEWANO_PG_USER"].filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`Missing ${missing.join(", ")} in .env.local`);
    process.exit(1);
  }
  await memory.ensureCatalog();
  console.log(`● Catalog   registered (hash ${catalogHash()})`);

  const id = `check_${Date.now()}`;
  await memory.record({
    id: `evt_${id}`,
    type: "task.created",
    occurredAt: new Date().toISOString(),
    summary: "Keewano connection check",
    data: {},
    userId: "usr_check",
    taskId: id,
    callId: null,
    orgKey: null,
    typed: { taskKind: "connection_check" },
  });
  console.log(`● Write     sent a test event to task ${entityUuid({ type: "task", id })}`);

  const t0 = Date.now();
  const total = await memory.sql("SELECT count(*) AS events, count(DISTINCT user_id) AS entities FROM events");
  console.log(`● SQL       ${JSON.stringify(total[0])} (${Date.now() - t0} ms)`);
  const kinds = await memory.sql("SELECT entity_kind, count(DISTINCT user_id) AS n FROM events GROUP BY entity_kind LIMIT 10").catch((e) => [{ error: (e as Error).message }]);
  console.log(`● Entities  ${JSON.stringify(kinds)}`);
  const userId = "usr_default";
  const rel = entityUuid({ type: "relationship", id: `${userId}:comcast` });
  const commitments = await memory.sql(`SELECT event_datetime AS t, commitment_received AS kind FROM events WHERE user_id = '${rel}' ORDER BY t`).catch((e) => [{ error: (e as Error).message }]);
  console.log(`● Comcast   commitments on the demo relationship: ${JSON.stringify(commitments)}`);
  // The read the call planner does: the whole user x Comcast timeline, rebuilt from Keewano.
  const tl = await memory.timeline({ type: "relationship", id: `${userId}:comcast` }, { since: new Date(Date.now() - 365 * 86_400_000).toISOString() });
  const fromKeewano = tl.events.filter((e) => e.source === "keewano");
  console.log(`● Timeline  ${fromKeewano.length} events from Keewano (${tl.trace[0]?.ms} ms), ${tl.events.length - fromKeewano.length} from the recent-writes cache`);
  for (const e of tl.events) console.log(`            ${e.occurredAt.slice(0, 16)} ${e.source === "keewano" ? "KW " : "loc"} ${e.summary}`);
  console.log("\nKeewano is wired up. Seed the demo history (dashboard > Demo controls) at least 30 minutes before you present.");
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => setTimeout(() => process.exit(0), 200));
