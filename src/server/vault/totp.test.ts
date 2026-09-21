import { describe, expect, it } from "vitest";
import { decodeBase32, totpFrom } from "./totp";

describe("decodeBase32", () => {
  it("decodes the RFC 4648 test vectors", () => {
    expect(Buffer.from(decodeBase32("MZXW6===")).toString()).toBe("foo");
    expect(Buffer.from(decodeBase32("JBSWY3DPEHPK3PXP")).toString("hex")).toBe(
      "48656c6c6f21deadbeef",
    );
  });

  it("ignores padding, spacing and case, which is how people paste them", () => {
    expect(Buffer.from(decodeBase32("jbswy3dpehpk3pxp")).toString("hex")).toBe(
      "48656c6c6f21deadbeef",
    );
    expect(Buffer.from(decodeBase32("JBSW Y3DP EHPK 3PXP")).toString("hex")).toBe(
      "48656c6c6f21deadbeef",
    );
  });

  it("refuses something that is not base32", () => {
    expect(() => decodeBase32("not-base-32!")).toThrow();
  });
});

describe("totpFrom", () => {
  /** The seed every TOTP example uses, so the codes are checkable by hand. */
  const SEED = "JBSWY3DPEHPK3PXP";

  it("produces a stable code for a known moment", () => {
    const first = totpFrom(SEED, { at: 1_600_000_000_000 });
    const again = totpFrom(SEED, { at: 1_600_000_000_000 });

    expect(first.code).toMatch(/^\d{6}$/);
    expect(again.code).toBe(first.code);
  });

  it("changes on the next step and not before", () => {
    const at = 1_600_000_000_000;
    // Same 30-second window.
    expect(totpFrom(SEED, { at: at + 5_000 }).code).toBe(totpFrom(SEED, { at }).code);
    // The next one.
    expect(totpFrom(SEED, { at: at + 30_000 }).code).not.toBe(totpFrom(SEED, { at }).code);
  });

  it("reports the seconds left on the current code", () => {
    expect(totpFrom(SEED, { at: 1_600_000_000_000 }).period_remaining).toBe(20);
    expect(totpFrom(SEED, { at: 1_600_000_020_000 }).period_remaining).toBe(30);
  });

  it("reads an otpauth URI, which is what most vaults store", () => {
    const uri = `otpauth://totp/Bothy:admin?secret=${SEED}&issuer=Bothy&digits=8&period=60`;
    const code = totpFrom(uri, { at: 1_600_000_000_000 });

    expect(code.code).toMatch(/^\d{8}$/);
    expect(code.period_remaining).toBeLessThanOrEqual(60);
  });

  it("matches the published RFC 6238 vectors", () => {
    // Appendix B: the seed "12345678901234567890", SHA-1, eight digits.
    const rfc = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

    for (const [seconds, expected] of [
      [59, "94287082"],
      [1111111109, "07081804"],
      [1234567890, "89005924"],
      [2000000000, "69279037"],
    ] as const) {
      expect(totpFrom(rfc, { at: seconds * 1000, digits: 8 }).code).toBe(expected);
    }
  });

  it("refuses a URI with no secret in it", () => {
    expect(() => totpFrom("otpauth://totp/Bothy:admin?issuer=Bothy")).toThrow();
    expect(() => totpFrom("   ")).toThrow();
  });
});
