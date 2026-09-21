import { hmac } from "@noble/hashes/hmac.js";
import { sha1 } from "@noble/hashes/legacy.js";

/**
 * RFC 6238 codes, for vaults that hand back a seed rather than a code.
 *
 * Bitwarden's sidecar computes the code itself, so this is only for the
 * providers that do not. The seed passes through memory for the length of one
 * reveal and is never stored, cached, or logged (CLAUDE.md).
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Base32 as RFC 4648, which is how every vault writes a TOTP seed. */
export function decodeBase32(input: string): Uint8Array {
  const clean = input.replace(/=+$/, "").replace(/\s/g, "").toUpperCase();

  let bits = 0;
  let value = 0;
  const out: number[] = [];

  for (const character of clean) {
    const index = ALPHABET.indexOf(character);
    if (index === -1) throw new Error("That is not a base32 secret");

    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

export type TotpOptions = { digits?: number; period?: number; at?: number };

/**
 * Takes either a bare seed or a full otpauth:// URI, which is what most vaults
 * store, and returns the code with the seconds left on it.
 */
export function totpFrom(
  secretOrUri: string,
  options: TotpOptions = {},
): { code: string; period_remaining: number } {
  let secret = secretOrUri.trim();
  let digits = options.digits ?? 6;
  let period = options.period ?? 30;

  if (secret.toLowerCase().startsWith("otpauth://")) {
    const url = new URL(secret);
    const params = url.searchParams;
    secret = params.get("secret") ?? "";
    digits = Number(params.get("digits") ?? digits);
    period = Number(params.get("period") ?? period);
  }
  if (secret === "") throw new Error("No TOTP secret to work from");
  if (!Number.isInteger(digits) || digits < 6 || digits > 10) digits = 6;
  if (!Number.isInteger(period) || period < 1 || period > 300) period = 30;

  const seconds = Math.floor((options.at ?? Date.now()) / 1000);
  const counter = Math.floor(seconds / period);

  const message = new Uint8Array(8);
  // A 64-bit counter, big endian; the top bits stay zero until the year 10889.
  new DataView(message.buffer).setUint32(4, counter >>> 0, false);
  new DataView(message.buffer).setUint32(0, Math.floor(counter / 2 ** 32), false);

  const digest = hmac(sha1, decodeBase32(secret), message);
  const offset = (digest[digest.length - 1] as number) & 0x0f;
  const binary =
    (((digest[offset] as number) & 0x7f) << 24) |
    (((digest[offset + 1] as number) & 0xff) << 16) |
    (((digest[offset + 2] as number) & 0xff) << 8) |
    ((digest[offset + 3] as number) & 0xff);

  return {
    code: String(binary % 10 ** digits).padStart(digits, "0"),
    period_remaining: period - (seconds % period),
  };
}
