import type { Fact } from "./domain/types";

// Sensitive values are shown masked everywhere except the call brief that
// genuinely needs them. Passwords, PINs and similar secrets are never stored.

/** "A1832" stays readable; long account numbers and emails are masked. */
export function redactValue(value: string): string {
  const v = value.trim();
  const email = v.match(/^([^@\s]{1,64})@([^@\s]+)$/);
  if (email) return `${email[1][0]}•••@${email[2]}`;
  const digits = v.replace(/\D/g, "");
  if (digits.length >= 5) return `•••${v.slice(-4)}`;
  if (v.length <= 4) return "••••";
  return `${v[0]}•••${v.slice(-2)}`;
}

export function redactFact(f: Fact): Fact {
  return f.sensitive ? { ...f, value: redactValue(f.value) } : f;
}

// Never asked of the user, by text or mid-call, whatever a business says it needs.
export const SECRET_FIELD = /password|passcode|\bpin\b|security (code|answer|question)|social security|\bssn\b|\bcvv\b|\bcvc\b|(full|entire|whole) (credit |debit )?card number/i;

// Never stored, never used on a call.
const HARD_SECRETS: RegExp[] = [
  /\b(password|passcode|passwd|pass word)\b\s*(is|:|=)?\s*\S+/gi,
  /\b(pin|security code|security answer)\b\s*(number\s*)?(is|:|=)?\s*\d{3,8}\b/gi,
  /\b\d{3}-\d{2}-\d{4}\b/g, // SSN
];
// Masked in logs and summaries (a long account number is legitimate task
// data, but it never belongs in an event summary).
const SECRET_PATTERNS: RegExp[] = [...HARD_SECRETS, /\b(?:\d[ -]?){13,19}\b/g];

export function containsSecret(text: string): boolean {
  return HARD_SECRETS.some((re) => {
    re.lastIndex = 0;
    return re.test(text);
  });
}

/** Replaces anything that looks like a password, PIN, SSN or card number. */
export function maskSecrets(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) out = out.replace(re, "[withheld]");
  return out;
}
