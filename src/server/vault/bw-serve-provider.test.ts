import { describe, expect, it } from "vitest";
import { toSummary } from "./bw-serve-provider";

describe("toSummary", () => {
  it("keeps only non-secret metadata", () => {
    const summary = toSummary({
      id: "item-1",
      name: "Firewall admin",
      collectionIds: ["col-1"],
      login: {
        username: "admin",
        totp: "JBSWY3DPEHPK3PXP",
        uris: [{ uri: "https://10.0.0.1" }],
      },
    });

    expect(summary).toEqual({
      id: "item-1",
      name: "Firewall admin",
      username: "admin",
      uri: "https://10.0.0.1",
      collectionIds: ["col-1"],
      hasTotp: true,
    });
  });

  it("never carries the TOTP seed itself", () => {
    const summary = toSummary({
      id: "x",
      name: "n",
      login: { totp: "JBSWY3DPEHPK3PXP" },
    });
    expect(JSON.stringify(summary)).not.toContain("JBSWY3DPEHPK3PXP");
  });

  it("reports no TOTP when the item has none", () => {
    expect(toSummary({ id: "x", name: "n", login: {} }).hasTotp).toBe(false);
    expect(toSummary({ id: "x", name: "n" }).hasTotp).toBe(false);
  });

  it("tolerates an item with no login block", () => {
    expect(toSummary({ id: "x", name: "Secure note" })).toMatchObject({
      username: null,
      uri: null,
      collectionIds: [],
    });
  });
});
