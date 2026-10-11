import { spawn } from "node:child_process";
import { setEnv } from "./env-file";

// npm run tunnel: a Cloudflare quick tunnel to the local app, so Dial can
// reach the webhook and MCP endpoints. Writes PUBLIC_BASE_URL to .env.local.
// Quick tunnels get a new URL every start; run `npm run dial:setup` after.

const port = process.env.PORT ?? process.argv[2] ?? "3210";
// HTTP/2 over TCP: the default QUIC (UDP) transport drops on many networks.
const child = spawn("cloudflared", ["tunnel", "--no-autoupdate", "--protocol", "http2", "--url", `http://localhost:${port}`], {
  stdio: ["ignore", "pipe", "pipe"],
});
let found = false;

function scan(chunk: Buffer) {
  const text = chunk.toString();
  const m = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (m && !found) {
    found = true;
    setEnv({ PUBLIC_BASE_URL: m[0] });
    console.log(`\nTunnel up: ${m[0]} -> http://localhost:${port}`);
    console.log("Saved PUBLIC_BASE_URL. Next: npm run dial:setup (then restart the app).\n");
  }
  if (/error|ERR/i.test(text) && !/INF/.test(text)) process.stderr.write(text);
}
child.stdout.on("data", scan);
child.stderr.on("data", scan);
child.on("exit", (code) => {
  console.log(`cloudflared exited (${code})`);
  process.exit(code ?? 0);
});
process.on("SIGINT", () => child.kill("SIGINT"));
