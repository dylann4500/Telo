import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// Reads and updates .env.local in place, keeping comments and order.

export const ENV_LOCAL = path.join(process.cwd(), ".env.local");

export function readEnvFile(file = ENV_LOCAL): Record<string, string> {
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

export function setEnv(values: Record<string, string>, file = ENV_LOCAL) {
  let text = existsSync(file) ? readFileSync(file, "utf8") : "";
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const re = new RegExp(`^\\s*${key}\\s*=.*$`, "m");
    text = re.test(text) ? text.replace(re, line) : `${text.replace(/\n*$/, "\n")}${line}\n`;
    process.env[key] = value;
  }
  writeFileSync(file, text);
}

export function mask(value: string | undefined): string {
  if (!value) return "(empty)";
  return value.length <= 8 ? "••••" : `${value.slice(0, 4)}…${value.slice(-4)}`;
}
