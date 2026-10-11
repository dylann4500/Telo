import { config as loadEnv } from "dotenv";
import { exec } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { mask, setEnv } from "./env-file";
loadEnv({ path: [".env.local", ".env"], quiet: true });

// npm run google:connect: connects Telo to your Google account, once.
// Gmail is read-only; Calendar gets free/busy and can add events. Uses a
// "Desktop app" OAuth client (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in
// .env.local) and Google's loopback redirect: a one-shot local server catches
// the sign-in, and the refresh token is saved to .env.local with the other keys.

const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function main() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error("Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (a Desktop app OAuth client) to .env.local first. See the Google section of .env.example.");
    process.exit(1);
  }
  const { GOOGLE_SCOPES } = await import("../src/server/google/auth");
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(16));

  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}/callback`;
  const url = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent", // always return a refresh token
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  })}`;

  const done = (res: http.ServerResponse, ok: boolean, text: string) => {
    res.writeHead(ok ? 200 : 400, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><meta charset="utf-8"><title>Telo</title><p style="font:16px system-ui;margin:40px">${text}</p>`);
  };

  server.on("request", async (req, res) => {
    const u = new URL(req.url ?? "/", redirectUri);
    if (u.pathname !== "/callback") return done(res, false, "Not found.");
    if (u.searchParams.get("state") !== state) return done(res, false, "That sign-in link is stale. Run npm run google:connect again.");
    const code = u.searchParams.get("code");
    if (!code) {
      done(res, false, `Google sign-in didn't finish (${u.searchParams.get("error") ?? "no code"}).`);
      console.error(`Google sign-in didn't finish: ${u.searchParams.get("error") ?? "no code"}`);
      process.exit(1);
    }
    const token = (await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code", code_verifier: verifier }),
    }).then((r) => r.json())) as { access_token?: string; refresh_token?: string; scope?: string; error?: string; error_description?: string };
    if (!token.refresh_token || !token.access_token) {
      done(res, false, "Google didn't return a refresh token. Remove Telo at myaccount.google.com/permissions and try again.");
      console.error(`No refresh token: ${token.error ?? ""} ${token.error_description ?? ""}`);
      process.exit(1);
    }
    // Google lets you untick scopes on the consent screen; say which are missing.
    const granted = new Set((token.scope ?? "").split(" "));
    const missing = GOOGLE_SCOPES.filter((s) => !granted.has(s));
    const profile = (await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { authorization: `Bearer ${token.access_token}` } })
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}))) as { emailAddress?: string };
    setEnv({ GOOGLE_REFRESH_TOKEN: token.refresh_token, ...(profile.emailAddress ? { GOOGLE_ACCOUNT_EMAIL: profile.emailAddress } : {}) });
    done(res, true, "Telo is connected to Google. You can close this tab.");
    console.log(`● Connected ${profile.emailAddress ?? "your Google account"}: Gmail (read-only) and Calendar.`);
    console.log(`  Saved GOOGLE_REFRESH_TOKEN (${mask(token.refresh_token)}) to .env.local. Restart the app to start reading email.`);
    if (missing.length) console.log(`  Not granted: ${missing.map((s) => s.split("/").pop()).join(", ")}. Run this again and leave every box ticked.`);
    server.close();
    process.exit(0);
  });

  console.log("Opening Google sign-in in your browser. If it doesn't open, visit:\n");
  console.log(`${url}\n`);
  exec(`open "${url}"`, () => {});
  setTimeout(() => {
    console.error("Timed out waiting for the Google sign-in (5 minutes).");
    process.exit(1);
  }, 5 * 60_000);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
