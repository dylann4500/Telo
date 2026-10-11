import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });

// npm run keewano:check: proves the Keewano setup end to end.
//   1. registers Telo's event catalog (idempotent)
//   2. writes one test event to a throwaway entity
//   3. runs live SQL: the project's event count and entity kinds, the HVAC vendor
//      ranking and Unit B's AC repairs (the reads a work order makes)
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
  // The portfolio's history (npm run seed:portfolio): the reads the work orders make.
  const { rankVendors, assetHistory } = await import("../src/server/portfolio/insights");
  const ranking = await rankVendors("hvac");
  console.log(`● Vendors   HVAC ranking from ${ranking.source} (${ranking.trace[0]?.ms ?? 0} ms):`);
  for (const s of ranking.value) console.log(`            ${s.vendor.name}: ${s.visits} visits, ${s.noShows} no-shows, ${s.late} late, ${s.firstFix}/${s.jobs} fixed first visit`);
  const ac = await assetHistory("ast_alder_b_ac");
  console.log(`● Unit B AC ${ac.value.repairs.length} repairs in the past year from ${ac.source}: ${ac.value.repairs.map((r) => `${r.at.slice(0, 10)} $${r.cents / 100}`).join(", ") || "none yet"}`);
  console.log("\nKeewano is wired up. Load the portfolio's history (npm run seed:portfolio) at least 30 minutes before you present.");
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => setTimeout(() => process.exit(0), 200));
