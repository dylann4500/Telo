// Every setting Telo reads from the environment, in one place. See
// .env.example for what each one means. Secrets stay server-side: nothing in
// this module is ever sent to the browser.

function env(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.trim() === "" ? undefined : value.trim();
}

function pick<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const value = env(name);
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export const config = {
  appName: "Telo",
  databaseUrl: env("DATABASE_URL") ?? "file:./data/telo.db",
  databaseAuthToken: env("DATABASE_AUTH_TOKEN"),
  publicBaseUrl: env("PUBLIC_BASE_URL"),

  user: {
    id: "usr_default",
    name: env("TELO_USER_NAME") ?? "Dylan",
    phone: env("TELO_USER_PHONE") ?? null,
    channel: pick("TELO_USER_CHANNEL", ["sms", "imessage", "whatsapp", "web"] as const, "sms"),
    timezone: env("TELO_TIMEZONE") ?? "America/Los_Angeles",
  },

  llm: {
    provider: pick("LLM_PROVIDER", ["anthropic", "mock"] as const, env("ANTHROPIC_API_KEY") ? "anthropic" : "mock"),
    model: env("TELO_MODEL") ?? "claude-opus-5-5",
    // Quick, frequent steps (sorting a text, status replies, summaries).
    fastModel: env("TELO_MODEL_FAST") ?? env("TELO_MODEL") ?? "claude-opus-5-5",
  },

  voice: {
    provider: pick("VOICE_PROVIDER", ["dial", "mock"] as const, env("DIAL_API_KEY") ? "dial" : "mock"),
    dialApiKey: env("DIAL_API_KEY"),
    dialWebhookSecret: env("DIAL_WEBHOOK_SECRET"),
    dialNumberId: env("DIAL_NUMBER_ID"),
    dialBaseUrl: env("DIAL_BASE_URL"),
    // Telo's own phone number, shown in the UI as "text or call Telo at ..."
    teloPhone: env("TELO_PHONE_NUMBER") ?? null,
    // Shared secret Dial sends when it calls Telo's MCP server mid-call.
    mcpToken: env("TELO_MCP_TOKEN"),
    // Also write a live status digest into the number's inbound prompt, so
    // a caller hears current status even if the agent skips the tool call.
    statusInInboundPrompt: env("TELO_INBOUND_STATUS_IN_PROMPT") !== "false",
    maxCallSeconds: Number(env("TELO_MAX_CALL_SECONDS") ?? "300"),
  },

  memory: {
    provider: pick("MEMORY_PROVIDER", ["keewano", "local"] as const, env("KEEWANO_API_KEY") ? "keewano" : "local"),
    keewano: {
      apiKey: env("KEEWANO_API_KEY"), // SDK-type project key (writes)
      pat: env("KEEWANO_PAT"), // personal access token kwpat-... (SQL reads)
      projectId: env("KEEWANO_PROJECT_ID"), // Postgres database name
      pgUser: env("KEEWANO_PG_USER"), // Keewano login email
      pgHost: env("KEEWANO_PG_HOST") ?? "pgsql.keewano.com",
      pgPort: Number(env("KEEWANO_PG_PORT") ?? "27543"),
      ingestUrl: env("KEEWANO_INGEST_URL") ?? "https://api.keewano.com/event/ingress/v1/json",
      entityNamespace: env("TELO_ENTITY_NAMESPACE"), // secret UUID namespace for entity ids
      // Keewano documents ~5 minutes before new events are queryable; we saw
      // 15-20 on a new project. Reads merge in our own recent writes for this long.
      cacheMinutes: Number(env("KEEWANO_CACHE_MINUTES") ?? "60"),
    },
  },

  demo: {
    // During a hackathon demo the "business" is a teammate's phone. Any
    // business without a known number is dialed here instead.
    targetPhone: env("DEMO_TARGET_PHONE") ?? null,
    devTools: env("TELO_DEV_TOOLS") !== "false",
    // How fast simulated calls play back (1 = real time-ish).
    mockSpeed: Number(env("MOCK_CALL_SPEED") ?? "1"),
  },

  calls: {
    maxAttemptsPerLeg: Number(env("TELO_MAX_ATTEMPTS") ?? "2"),
    staleAfterMinutes: Number(env("TELO_CALL_STALE_MINUTES") ?? "20"),
  },
} as const;

export type Config = typeof config;
