import { mkdirSync } from "node:fs";
import path from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { config } from "../config";
import * as schema from "./schema";

export type Db = LibSQLDatabase<typeof schema>;

// Next.js can load this module more than once in one process (route
// bundles, instrumentation, hot reload), so the connection and the one-time
// setup live on globalThis.
const g = globalThis as unknown as {
  __teloDb?: { client: Client; db: Db };
  __teloDbReady?: Promise<void>;
};

function open() {
  if (config.databaseUrl.startsWith("file:")) {
    const file = config.databaseUrl.slice("file:".length);
    mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }
  const client = createClient({ url: config.databaseUrl, authToken: config.databaseAuthToken });
  return { client, db: drizzle({ client, schema }) };
}

const handle = (g.__teloDb ??= open());
export const db: Db = handle.db;

/** Runs migrations and seeds the single demo user. Safe to call on every request. */
export function ensureDb(): Promise<void> {
  g.__teloDbReady ??= (async () => {
    if (config.databaseUrl.startsWith("file:")) {
      await handle.client.execute("PRAGMA journal_mode = WAL");
      await handle.client.execute("PRAGMA busy_timeout = 5000");
    }
    await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
    const { seedBaseline } = await import("./seed");
    await seedBaseline();
  })().catch((err) => {
    g.__teloDbReady = undefined; // let the next request retry
    throw err;
  });
  return g.__teloDbReady;
}

export { schema };
