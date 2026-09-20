import { describe, expect, it } from "vitest";
import { apiKeyInputSchema, hashKey, hasScope, splitKey } from "./api-keys";

const COMPANY = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

describe("apiKeyInputSchema", () => {
  it("keeps a valid key definition", () => {
    expect(
      apiKeyInputSchema.parse({ name: "  HaloPSA  ", scopes: ["read"], allCompanies: true }),
    ).toEqual({
      name: "HaloPSA",
      scopes: ["read"],
      allCompanies: true,
      companyIds: [],
    });
  });

  it("removes duplicate scopes", () => {
    expect(
      apiKeyInputSchema.parse({ name: "x", scopes: ["read", "read"], allCompanies: true }).scopes,
    ).toEqual(["read"]);
  });

  it("takes a list of companies instead of every company", () => {
    const parsed = apiKeyInputSchema.parse({
      name: "x",
      scopes: ["read"],
      companyIds: [COMPANY, COMPANY, OTHER],
    });
    expect(parsed.allCompanies).toBe(false);
    expect(parsed.companyIds).toEqual([COMPANY, OTHER]);
  });

  it("refuses a key that could see nothing at all", () => {
    // Default-deny: a key has to say which companies it is for.
    const result = apiKeyInputSchema.safeParse({ name: "x", scopes: ["read"] });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["companyIds"]);
  });

  it("requires at least one scope", () => {
    expect(
      apiKeyInputSchema.safeParse({ name: "x", scopes: [], allCompanies: true }).success,
    ).toBe(false);
  });

  it("rejects an unknown scope", () => {
    expect(
      apiKeyInputSchema.safeParse({ name: "x", scopes: ["root"], allCompanies: true }).success,
    ).toBe(false);
  });
});

describe("hashKey", () => {
  it("is a hex sha256", () => {
    expect(hashKey("bothy_abc")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never contains the key", () => {
    expect(hashKey("bothy_secret")).not.toContain("secret");
  });
});

describe("splitKey", () => {
  it("recognizes a key with its marker", () => {
    expect(splitKey("bothy_abc123")).toEqual({ marker: "bothy_", body: "abc123" });
  });

  it("treats anything else as a bare body", () => {
    expect(splitKey("abc123")).toEqual({ marker: "", body: "abc123" });
  });
});

describe("hasScope", () => {
  it("lets admin do anything", () => {
    expect(hasScope(["admin"], "read")).toBe(true);
    expect(hasScope(["admin"], "write")).toBe(true);
    expect(hasScope(["admin"], "admin")).toBe(true);
  });

  it("lets write imply read", () => {
    expect(hasScope(["write"], "read")).toBe(true);
    expect(hasScope(["write"], "write")).toBe(true);
  });

  it("keeps read read-only", () => {
    expect(hasScope(["read"], "read")).toBe(true);
    expect(hasScope(["read"], "write")).toBe(false);
    expect(hasScope(["read"], "admin")).toBe(false);
  });

  it("refuses when nothing is granted", () => {
    expect(hasScope([], "read")).toBe(false);
  });

  it("never implies secrets:reveal, not even for admin", () => {
    expect(hasScope(["admin"], "secrets:reveal")).toBe(false);
    expect(hasScope(["write"], "secrets:reveal")).toBe(false);
    expect(hasScope(["secrets:reveal"], "secrets:reveal")).toBe(true);
  });

  it("does not let secrets:reveal stand in for reading", () => {
    expect(hasScope(["secrets:reveal"], "read")).toBe(false);
  });
});
