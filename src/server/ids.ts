import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** Short, prefixed, URL-safe ids like `tsk_k3j9x0a1b2c3`. */
export function newId(prefix: "usr" | "tsk" | "call" | "q" | "msg" | "evt"): string {
  const bytes = randomBytes(12);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${out}`;
}

/** Normalizes a business name into a stable key: "Comcast Xfinity, Inc." -> "comcast-xfinity". */
export function orgKeyFor(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(inc|llc|ltd|co|corp|corporation|company)\b\.?/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
