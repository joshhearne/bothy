import { beforeAll, describe, expect, it, vi } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/env", () => ({ env: { AUTH_SECRET: "a-test-secret" } }));
vi.mock("@/server/services/settings", () => ({
  getKbPublicSettings: async () => ({}),
}));

import { accessIssuer, readerKey, verifyAccessToken } from "./identity";

const TEAM = "calder-ridge";
const AUD = "0123456789abcdef";

let keys: JWTVerifyGetKey;
let sign: (
  claims: Record<string, unknown>,
  options?: { issuer?: string; audience?: string; expired?: boolean },
) => Promise<string>;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  const other = await generateKeyPair("RS256");
  keys = createLocalJWKSet({
    keys: [{ ...(await exportJWK(pair.publicKey)), kid: "one", alg: "RS256" }],
  });

  sign = async (claims, options = {}) => {
    const jwt = new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: "one" })
      .setIssuer(options.issuer ?? accessIssuer(TEAM))
      .setAudience(options.audience ?? AUD)
      .setIssuedAt()
      .setExpirationTime(options.expired ? "-1h" : "1h");
    return jwt.sign(claims.wrongKey ? other.privateKey : pair.privateKey);
  };
});

describe("verifyAccessToken", () => {
  it("answers the address a good token names", async () => {
    const token = await sign({ email: "Reader@Example.com" });
    expect(await verifyAccessToken(token, TEAM, AUD, keys)).toBe("Reader@Example.com");
  });

  it("refuses a token for another application", async () => {
    const token = await sign({ email: "reader@example.com" }, { audience: "fedcba9876543210" });
    expect(await verifyAccessToken(token, TEAM, AUD, keys)).toBeNull();
  });

  it("refuses a token from another team", async () => {
    const token = await sign(
      { email: "reader@example.com" },
      { issuer: accessIssuer("someone-else") },
    );
    expect(await verifyAccessToken(token, TEAM, AUD, keys)).toBeNull();
  });

  it("refuses a token that has expired, one signed with another key, and junk", async () => {
    expect(
      await verifyAccessToken(
        await sign({ email: "r@example.com" }, { expired: true }),
        TEAM,
        AUD,
        keys,
      ),
    ).toBeNull();
    expect(
      await verifyAccessToken(
        await sign({ email: "r@example.com", wrongKey: true }),
        TEAM,
        AUD,
        keys,
      ),
    ).toBeNull();
    expect(await verifyAccessToken("not.a.token", TEAM, AUD, keys)).toBeNull();
  });

  it("refuses a token that names nobody", async () => {
    const token = await sign({ sub: "service-token" });
    expect(await verifyAccessToken(token, TEAM, AUD, keys)).toBeNull();
  });
});

describe("readerKey", () => {
  it("is the same for the same person however they spell it, and tells nothing", () => {
    const key = readerKey("Reader@Example.com");
    expect(readerKey(" reader@example.com ")).toBe(key);
    expect(readerKey("other@example.com")).not.toBe(key);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain("example");
  });
});
