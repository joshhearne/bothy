import { describe, expect, it, vi } from "vitest";
import { open, seal } from "./secret-box";
import {
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
  RECOVERY_CODE_COUNT,
} from "./recovery-codes";

vi.mock("server-only", () => ({}));
const { checkPasswordBreach } = await import("./password-breach");

describe("secret box", () => {
  it("opens what it sealed, and nothing else", () => {
    const sealed = seal("JBSWY3DPEHPK3PXP", "instance-secret", "totp");
    expect(sealed).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(sealed).not.toContain("JBSWY3DP");
    expect(open(sealed, "instance-secret", "totp")).toBe("JBSWY3DPEHPK3PXP");
    expect(open(sealed, "another-secret", "totp")).toBeNull();
    expect(open(sealed, "instance-secret", "other-purpose")).toBeNull();
    expect(open(`${sealed}x`, "instance-secret", "totp")).toBeNull();
    expect(open("garbage", "instance-secret", "totp")).toBeNull();
  });

  it("seals the same thing differently each time", () => {
    expect(seal("a", "s", "p")).not.toBe(seal("a", "s", "p"));
  });
});

describe("recovery codes", () => {
  it("makes ten distinct codes in a shape a person can read", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
    for (const code of codes) expect(code).toMatch(/^[a-hj-kmnp-z2-9]{5}-[a-hj-kmnp-z2-9]{5}$/);
  });

  it("hashes a code the same however it was typed", () => {
    expect(normalizeRecoveryCode(" ABCDE-fghjk ")).toBe("abcdefghjk");
    expect(hashRecoveryCode("ABCDE FGHJK")).toBe(hashRecoveryCode("abcde-fghjk"));
    expect(hashRecoveryCode("abcde-fghjk")).not.toBe(hashRecoveryCode("abcde-fghjm"));
  });
});

describe("password breach check", () => {
  // SHA-1 of "password" is 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8.
  const fetcher = (body: string, ok = true) =>
    (async () => new Response(body, { status: ok ? 200 : 503 })) as unknown as typeof fetch;

  it("finds a breached password by its suffix and reports how often", async () => {
    const result = await checkPasswordBreach(
      "password",
      fetcher("0000000000000000000000000000000000A:0\r\n1E4C9B93F3F0682250B6CF8331B7EE68FD8:3861493\r\n"),
    );
    expect(result).toEqual({ breached: true, checked: true, count: 3861493 });
  });

  it("does not count a padding line as a sighting", async () => {
    const result = await checkPasswordBreach("password", fetcher("1E4C9B93F3F0682250B6CF8331B7EE68FD8:0\n"));
    expect(result).toEqual({ breached: false, checked: true });
  });

  it("answers not breached, unchecked, when the service is away", async () => {
    expect(await checkPasswordBreach("password", fetcher("", false))).toEqual({ breached: false, checked: false });
    const failing = (async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    expect(await checkPasswordBreach("password", failing)).toEqual({ breached: false, checked: false });
  });
});
