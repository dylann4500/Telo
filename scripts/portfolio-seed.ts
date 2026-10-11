import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });

// npm run seed:portfolio: loads the seeded portfolio's history (work orders
// from before Telo) into the local database and mirrors it to the memory
// provider: Keewano when it's configured. Safe to run twice. Run it at least
// 30 minutes before presenting: new Keewano events take about 5 minutes to
// become queryable, and 15-20 on a fresh project.

async function main() {
  const { ensureDb, db } = await import("../src/server/db/client");
  await ensureDb();
  const { config } = await import("../src/server/config");
  const { seedPortfolioHistory } = await import("../src/server/portfolio/history");
  const { syncPendingEvents } = await import("../src/server/memory/events");
  const { events } = await import("../src/server/db/schema");
  const { isNull, isNotNull, and, like } = await import("drizzle-orm");

  const r = await seedPortfolioHistory();
  console.log(`● Seeded    ${r.created} new of ${r.total} portfolio events (memory: ${config.memory.provider})`);
  let sent = 0;
  for (;;) {
    const n = await syncPendingEvents(50);
    sent += n;
    if (n === 0) break;
    process.stdout.write(`\r● Syncing   ${sent} events sent to ${config.memory.provider}`);
  }
  if (sent) process.stdout.write("\n");
  const pending = await db.select({ id: events.id, error: events.memorySyncError }).from(events).where(and(isNull(events.memorySyncedAt), like(events.id, "evt_pf_%")));
  const synced = await db.select({ id: events.id }).from(events).where(and(isNotNull(events.memorySyncedAt), like(events.id, "evt_pf_%")));
  console.log(`● Status    ${synced.length} portfolio events synced, ${pending.length} pending`);
  if (pending.length) console.log(`  first error: ${pending.find((p) => p.error)?.error ?? "(none yet)"}`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => setTimeout(() => process.exit(0), 200));
