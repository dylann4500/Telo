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
    channel: pick("TELO_USER_CHANNEL", ["sms", "imessage", "whatsapp", "voice", "web"] as const, "sms"),
    // The starting value of the "text me / text and call me" toggle (only used when the user row is created).
    callUpdates: env("TELO_CALL_UPDATES") !== "false",
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

  google: {
    // A "Desktop app" OAuth client in Google Cloud. `npm run google:connect`
    // signs in once and saves the refresh token here.
    clientId: env("GOOGLE_CLIENT_ID"),
    clientSecret: env("GOOGLE_CLIENT_SECRET"),
    refreshToken: env("GOOGLE_REFRESH_TOKEN"),
    account: env("GOOGLE_ACCOUNT_EMAIL") ?? null,
  },

  mail: {
    // gmail: read the inbox (read-only). mock: a local inbox for tests and demos.
    provider: pick("MAIL_PROVIDER", ["gmail", "mock", "off"] as const, env("GOOGLE_REFRESH_TOKEN") ? "gmail" : "off"),
    pollSeconds: Number(env("TELO_MAIL_POLL_SECONDS") ?? "60"),
    // How far back the inbox scan looks (it never reprocesses a message).
    lookbackDays: Number(env("TELO_MAIL_LOOKBACK_DAYS") ?? "2"),
    // On first connect, read what's already in the inbox (default: only new mail).
    readBacklog: env("TELO_MAIL_READ_BACKLOG") === "true",
  },

  calendar: {
    // google: free/busy for suggesting times, and bookings written to the primary calendar.
    provider: pick("CALENDAR_PROVIDER", ["google", "mock", "off"] as const, env("GOOGLE_REFRESH_TOKEN") ? "google" : "off"),
    addBookings: env("TELO_CALENDAR_ADD_BOOKINGS") !== "false",
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
    // An unanswered call is retried after this many minutes, not instantly.
    retryMinutes: Number(env("TELO_RETRY_MINUTES") ?? "20"),
    // Outbound calls one task may make in total (retries, callbacks, scheduled check-ins).
    maxCallsPerTask: Number(env("TELO_MAX_CALLS_PER_TASK") ?? "6"),
    // One nudge when a question to the user has gone unanswered this long.
    remindAfterHours: Number(env("TELO_REMIND_AFTER_HOURS") ?? "4"),
    staleAfterMinutes: Number(env("TELO_CALL_STALE_MINUTES") ?? "20"),
  },
} as const;

export type Config = typeof config;
