import { describe, expect, it } from "vitest";
import {
  fromBase32,
  generateTotpSecret,
  otpauthUrl,
  toBase32,
  totpCode,
  totpStep,
  verifyTotp,
} from "./totp";

/** The RFC 6238 test seed, "12345678901234567890", as authenticator apps take it. */
const RFC_SECRET = toBase32(new TextEncoder().encode("12345678901234567890"));

describe("totp", () => {
  it("produces the RFC 6238 SHA-1 test vectors", () => {
    // Appendix B, truncated to six digits.
    const vectors: [number, string][] = [
      [59, "287082"],
      [1111111109, "081804"],
      [1111111111, "050471"],
      [1234567890, "005924"],
      [2000000000, "279037"],
      [20000000000, "353130"],
    ];
    for (const [seconds, code] of vectors) {
      expect(totpCode(RFC_SECRET, totpStep(seconds * 1000))).toBe(code);
    }
  });

  it("round-trips base32", () => {
    const bytes = Uint8Array.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(fromBase32(toBase32(bytes))).toEqual(bytes);
    expect(fromBase32("jbsw y3dp eb3w 64tm mq")).toEqual(new TextEncoder().encode("Hello world"));
  });

  it("accepts the current step and one either side, and no further", () => {
    const at = 1111111111 * 1000;
    const step = totpStep(at);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step), { atMs: at })).toEqual({ ok: true, step });
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 1), { atMs: at }).ok).toBe(true);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step + 1), { atMs: at }).ok).toBe(true);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 2), { atMs: at }).ok).toBe(false);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step + 2), { atMs: at }).ok).toBe(false);
  });

  it("refuses a code that was already accepted", () => {
    const at = 1111111111 * 1000;
    const step = totpStep(at);
    const code = totpCode(RFC_SECRET, step);
    expect(verifyTotp(RFC_SECRET, code, { atMs: at, afterStep: step }).ok).toBe(false);
    expect(verifyTotp(RFC_SECRET, code, { atMs: at, afterStep: step - 1 }).ok).toBe(true);
  });

  it("forgives spaces and refuses anything that is not six digits", () => {
    const at = 1111111111 * 1000;
    const code = totpCode(RFC_SECRET, totpStep(at));
    expect(verifyTotp(RFC_SECRET, `${code.slice(0, 3)} ${code.slice(3)}`, { atMs: at }).ok).toBe(true);
    expect(verifyTotp(RFC_SECRET, "12345", { atMs: at }).ok).toBe(false);
    expect(verifyTotp(RFC_SECRET, "abcdef", { atMs: at }).ok).toBe(false);
  });

  it("makes a seed an app can scan", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    const url = otpauthUrl(secret, "sam@example.com", "Trove KB");
    expect(url).toBe(
      `otpauth://totp/Trove%20KB%3Asam%40example.com?secret=${secret}&issuer=Trove%20KB&algorithm=SHA1&digits=6&period=30`,
    );
  });
});
