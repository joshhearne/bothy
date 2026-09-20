import { describe, expect, it } from "vitest";
import { hash as nativeHash, verify as nativeVerify } from "@node-rs/argon2";
import { hashPassword, parseHash, verifyPassword } from "./password";

/**
 * Bothy hashes in plain JavaScript so one implementation serves both the
 * container and Workers. Argon2id is a standard, so hashes must travel in both
 * directions between Bothy and any other implementation. This runs the native
 * binding for real to prove it, rather than trusting the format by eye.
 */

const OPTIONS = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
const PASSWORD = "a-sufficiently-long-password";

describe("Argon2id hashes are portable across implementations", () => {
  it("verifies a hash the native binding produced", async () => {
    const stored = await nativeHash(PASSWORD, OPTIONS);
    expect(await verifyPassword(stored, PASSWORD)).toBe(true);
    expect(await verifyPassword(stored, "wrong")).toBe(false);
  });

  it("produces a hash the native binding accepts", async () => {
    const stored = await hashPassword(PASSWORD);
    expect(await nativeVerify(stored, PASSWORD, OPTIONS)).toBe(true);
    expect(await nativeVerify(stored, "wrong", OPTIONS)).toBe(false);
  });

  it("writes the documented parameters into the encoded string", async () => {
    expect(await hashPassword(PASSWORD)).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });

  it("round-trips salt and digest through the encoding", async () => {
    const stored = await hashPassword(PASSWORD);
    const parsed = parseHash(stored);

    expect(parsed).not.toBeNull();
    expect(parsed?.salt).toHaveLength(16);
    expect(parsed?.hash).toHaveLength(32);
    expect(parsed?.memoryKib).toBe(19456);
  });

  it("refuses anything that is not an Argon2id PHC string", () => {
    for (const bad of ["", "not-a-hash", "$argon2i$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA", "$argon2id$"]) {
      expect(parseHash(bad)).toBeNull();
    }
  });

  it("verifies a hash written with different cost parameters", async () => {
    // A hash from an older configuration must still let its owner in.
    const cheaper = await nativeHash(PASSWORD, { ...OPTIONS, memoryCost: 8192, timeCost: 1 });
    expect(await verifyPassword(cheaper, PASSWORD)).toBe(true);
  });
});
