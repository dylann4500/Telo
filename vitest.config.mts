import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    pool: "forks",
    // Never touch the dev database; the flow test points at its own temp file.
    // Google off unless a test asks for the simulated inbox or calendar: never the real account.
    env: { DATABASE_URL: "file:./data/test-units.db", LLM_PROVIDER: "mock", VOICE_PROVIDER: "mock", MEMORY_PROVIDER: "local", MAIL_PROVIDER: "off", CALENDAR_PROVIDER: "off" },
  },
});
