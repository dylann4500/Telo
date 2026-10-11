import { randomInt } from "node:crypto";
import { eq } from "drizzle-orm";
import { config } from "./config";
import { db } from "./db/client";
import { appState, users } from "./db/schema";

// Linking the user's phone without typing it anywhere: until a phone is on
// file, the dashboard shows a one-time code, and a text of "LINK <code>" to
// Telo's number makes the sender the owner of this Telo.

const KEY = "pairing.code";

export async function pairingCode(): Promise<string | null> {
  const user = await db.query.users.findFirst({ where: eq(users.id, config.user.id) });
  if (!user || user.phone) return null;
  const row = await db.query.appState.findFirst({ where: eq(appState.key, KEY) });
  if (typeof row?.value === "string") return row.value;
  const code = String(randomInt(1000, 10000));
  await db.insert(appState).values({ key: KEY, value: code }).onConflictDoUpdate({ target: appState.key, set: { value: code } });
  return code;
}

/** Returns true if this text linked the sender's phone. */
export async function tryPair(from: string, body: string): Promise<boolean> {
  const m = body.trim().match(/^link\s+(\d{4})$/i);
  if (!m) return false;
  const code = await pairingCode();
  if (!code || m[1] !== code) return false;
  const digits = from.replace(/\D/g, "");
  const phone = digits.length === 10 ? `+1${digits}` : `+${digits}`;
  await db.update(users).set({ phone }).where(eq(users.id, config.user.id));
  await db.delete(appState).where(eq(appState.key, KEY));
  console.info("[pairing] linked the user's phone");
  return true;
}
