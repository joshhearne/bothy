import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword, MIN_PASSWORD_LENGTH } from "./password";

describe("password hashing", () => {
  it("produces an Argon2id hash", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash.startsWith("$argon2id$")).toBe(true);
  });

  it("never stores the password in the hash", async () => {
    const secret = "correct horse battery staple";
    expect(await hashPassword(secret)).not.toContain(secret);
  });

  it("salts each hash", async () => {
    const [a, b] = await Promise.all([hashPassword("same-password"), hashPassword("same-password")]);
    expect(a).not.toEqual(b);
  });

  it("verifies the right password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword(hash, "correct horse battery staple")).toBe(true);
  });

  it("rejects the wrong password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword(hash, "Correct horse battery staple")).toBe(false);
  });

  it("returns false for a malformed hash instead of throwing", async () => {
    expect(await verifyPassword("not-a-hash", "whatever")).toBe(false);
  });

  it("requires at least 12 characters", () => {
    expect(MIN_PASSWORD_LENGTH).toBeGreaterThanOrEqual(12);
  });
});
