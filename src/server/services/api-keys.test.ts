import { describe, expect, it } from "vitest";
import { apiKeyInputSchema, hashKey, hasScope } from "./api-keys";

describe("apiKeyInputSchema", () => {
  it("keeps a valid key definition", () => {
    expect(apiKeyInputSchema.parse({ name: "  HaloPSA  ", scopes: ["read"] })).toEqual({
      name: "HaloPSA",
      scopes: ["read"],
    });
  });

  it("removes duplicate scopes", () => {
    expect(apiKeyInputSchema.parse({ name: "x", scopes: ["read", "read"] }).scopes).toEqual(["read"]);
  });

  it("requires at least one scope", () => {
    expect(apiKeyInputSchema.safeParse({ name: "x", scopes: [] }).success).toBe(false);
  });

  it("rejects an unknown scope", () => {
    expect(apiKeyInputSchema.safeParse({ name: "x", scopes: ["root"] }).success).toBe(false);
  });
});

describe("hashKey", () => {
  it("is a hex sha256", () => {
    expect(hashKey("strata_abc")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never contains the key", () => {
    expect(hashKey("strata_secret")).not.toContain("secret");
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
});
