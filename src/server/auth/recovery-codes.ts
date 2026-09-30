import { createHash, randomBytes } from "node:crypto";

/**
 * Recovery codes: ten of them, each used once, for the day the phone and the
 * key are both out of reach. Only a hash of each is kept, so they are shown
 * once, at the moment they are made, and never again.
 */

export const RECOVERY_CODE_COUNT = 10;

/* No 0/O or 1/I/L, so a code read off paper is typed right. */
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

function group(): string {
  const bytes = randomBytes(5);
  let out = "";
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return out;
}

/** `xxxxx-xxxxx`: fifty bits, which nobody guesses in ten tries. */
export function generateRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => `${group()}-${group()}`);
}

/** Case, spaces, and the dash are forgiven. */
export function normalizeRecoveryCode(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(normalizeRecoveryCode(code)).digest("hex");
}
