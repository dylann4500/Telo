import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });

// npm run llm:check: one quick and one main-tier Claude call, to confirm the
// key, both models and structured outputs work. Costs a fraction of a cent.

async function main() {
  const { config } = await import("../src/server/config");
  if (config.llm.provider !== "anthropic") {
    console.error("ANTHROPIC_API_KEY is not set; Telo is using the rule-based stand-in.");
    process.exit(1);
  }
  const agent = await import("../src/server/agent");
  let t = Date.now();
  const route = await agent.routeInbound({
    text: "can you cancel my equinox membership",
    via: "message",
    now: new Date().toISOString(),
    openTasks: [],
    recentConversation: [],
  });
  console.log(`● ${config.llm.fastModel} (fast) routed a text in ${Date.now() - t} ms -> ${route.actions.map((a) => a.type).join(", ")}`);

  t = Date.now();
  const u = await agent.understandTask({
    request: "can you cancel my equinox membership",
    now: new Date().toString(),
    user: { name: config.user.name, phone: null },
    preferences: [],
    directory: [{ name: "Equinox", phone: "+14155550100", aliases: ["gym"] }],
    knownFacts: [],
    recentBusinesses: [],
    availability: null,
  });
  console.log(`● ${config.llm.model} (main) understood it in ${Date.now() - t} ms -> "${u.title}", asks: ${u.missing.map((m) => m.label).join(", ") || "nothing"}`);
  console.log(`  acknowledgement: ${u.acknowledgement}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
