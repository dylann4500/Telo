import { config } from "../config";

// Google OAuth for Telo's Gmail (read-only) and Calendar access. The refresh
// token comes from `npm run google:connect` (a Desktop-app OAuth client with
// a loopback redirect). Access tokens are refreshed here and cached in memory.

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.events", // create events (bookings)
  "https://www.googleapis.com/auth/calendar.freebusy", // free/busy; calendar.events alone doesn't allow it
];

export class GoogleAuthError extends Error {}

// Module-level, so a code edit takes effect on hot reload.
let cached: { token: string; expiresAt: number } | undefined;

export function googleConnected(): boolean {
  return Boolean(config.google.clientId && config.google.clientSecret && config.google.refreshToken);
}

export async function googleAccessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const { clientId, clientSecret, refreshToken } = config.google;
  if (!clientId || !clientSecret || !refreshToken) throw new GoogleAuthError("Google isn't connected. Run npm run google:connect.");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !body.access_token) {
    // invalid_grant: access was revoked, or the 7-day refresh token of an app in Testing mode expired.
    throw new GoogleAuthError(`Google sign-in expired or was revoked (${body.error ?? res.status}). Run npm run google:connect again.`);
  }
  cached = { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return cached.token;
}

/** A Google API call with the user's token, retried once after a 401. */
export async function googleFetch<T>(url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const token = await googleAccessToken();
    const res = await fetch(url, {
      method: init.method ?? "GET",
      headers: { authorization: `Bearer ${token}`, ...(init.body !== undefined ? { "content-type": "application/json" } : {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    if (res.status === 401 && attempt === 0) {
      cached = undefined;
      continue;
    }
    if (!res.ok) throw new Error(`Google API ${res.status} on ${new URL(url).pathname}: ${(await res.text()).slice(0, 300)}`);
    return (await res.json()) as T;
  }
}
