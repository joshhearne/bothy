import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Time-based one-time passwords, RFC 6238 over RFC 4226: SHA-1, six digits,
 * thirty-second steps, which is what every authenticator app produces. A
 * code is accepted from the step before and the step after the current one,
 * for a phone whose clock is a little off.
 */

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
const DRIFT_STEPS = 1;

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function toBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function fromBase32(text: string): Uint8Array {
  const clean = text.toUpperCase().replace(/[^A-Z2-7]/g, "");
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    value = (value << 5) | BASE32.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

/** A fresh seed: 160 bits, which is what the standard suggests for SHA-1. */
export function generateTotpSecret(): string {
  return toBase32(randomBytes(20));
}

/** What the authenticator app scans. */
export function otpauthUrl(secret: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const query = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}

export function totpStep(atMs = Date.now()): number {
  return Math.floor(atMs / 1000 / TOTP_STEP_SECONDS);
}

/** The code for one step. */
export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", Buffer.from(fromBase32(secret))).update(counter).digest();
  const offset = (digest[digest.length - 1] as number) & 0x0f;
  const binary =
    (((digest[offset] as number) & 0x7f) << 24) |
    (((digest[offset + 1] as number) & 0xff) << 16) |
    (((digest[offset + 2] as number) & 0xff) << 8) |
    ((digest[offset + 3] as number) & 0xff);
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

/**
 * Whether the code is right for now, give or take a step, and which step it
 * belongs to. Steps at or before `afterStep` are refused, so a code that was
 * already accepted cannot be played again.
 */
export function verifyTotp(
  secret: string,
  code: string,
  options: { atMs?: number; afterStep?: number | null } = {},
): { ok: boolean; step: number | null } {
  const given = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(given)) return { ok: false, step: null };

  const now = totpStep(options.atMs);
  for (let offset = -DRIFT_STEPS; offset <= DRIFT_STEPS; offset += 1) {
    const step = now + offset;
    if (options.afterStep !== undefined && options.afterStep !== null && step <= options.afterStep) {
      continue;
    }
    const expected = Buffer.from(totpCode(secret, step));
    if (timingSafeEqual(expected, Buffer.from(given))) return { ok: true, step };
  }
  return { ok: false, step: null };
}
