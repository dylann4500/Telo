// Runs once when the Next.js server starts: migrate the database and start
// the background loop (retries, missed-webhook recovery, memory sync).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { ensureDb } = await import("./server/db/client");
  await ensureDb();
  const { startBackgroundLoop } = await import("./server/background");
  startBackgroundLoop();
}
