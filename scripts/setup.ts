import { copyFileSync, existsSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { ENV_LOCAL, readEnvFile, setEnv } from "./env-file";

// npm run setup: create .env.local from .env.example, generate the values
// Telo makes itself, and list what's still needed for each live service.

if (!existsSync(ENV_LOCAL)) {
  copyFileSync(".env.example", ENV_LOCAL);
  console.log("Created .env.local from .env.example");
}
const env = readEnvFile();
const generated: Record<string, string> = {};
if (!env.TELO_MCP_TOKEN) generated.TELO_MCP_TOKEN = randomBytes(24).toString("hex");
if (!env.TELO_ENTITY_NAMESPACE) generated.TELO_ENTITY_NAMESPACE = randomUUID();
if (Object.keys(generated).length) {
  setEnv(generated);
  console.log(`Generated ${Object.keys(generated).join(", ")}`);
}

const now = readEnvFile();
const check = (name: string, keys: string[], hint: string) => {
  const missing = keys.filter((k) => !now[k]);
  console.log(`${missing.length ? "○" : "●"} ${name.padEnd(9)} ${missing.length ? `missing ${missing.join(", ")}. ${hint}` : "configured"}`);
};
console.log("");
check("You", ["TELO_USER_PHONE"], "Your mobile in E.164, e.g. +14155550123.");
check("Claude", ["ANTHROPIC_API_KEY"], "console.anthropic.com > API keys. Without it, a rule-based stand-in runs.");
check("Dial", ["DIAL_API_KEY"], "getdial.ai dashboard > API keys. Then run npm run tunnel and npm run dial:setup.");
check("Keewano", ["KEEWANO_API_KEY", "KEEWANO_PAT", "KEEWANO_PROJECT_ID", "KEEWANO_PG_USER"], "app.keewano.com settings. Then npm run keewano:check.");
check("Demo", ["DEMO_TARGET_PHONE"], "A teammate's phone to play the business.");
