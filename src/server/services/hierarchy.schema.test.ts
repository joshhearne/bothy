import { describe, expect, it } from "vitest";
import { companyInputSchema } from "./companies";
import { locationInputSchema } from "./locations";

describe("companyInputSchema", () => {
  it("trims the name and defaults isInternal to false", () => {
    const parsed = companyInputSchema.parse({ name: "  Acme Ltd  " });
    expect(parsed).toMatchObject({ name: "Acme Ltd", isInternal: false });
  });

  it("rejects a blank name", () => {
    expect(companyInputSchema.safeParse({ name: "   " }).success).toBe(false);
  });

  it("rejects a name over 200 characters", () => {
    expect(companyInputSchema.safeParse({ name: "x".repeat(201) }).success).toBe(false);
  });

  it("accepts notes and the internal flag", () => {
    const parsed = companyInputSchema.parse({
      name: "Internal IT",
      isInternal: true,
      notes: "  Our own org  ",
    });
    expect(parsed).toMatchObject({ isInternal: true, notes: "Our own org" });
  });
});

describe("locationInputSchema", () => {
  it("trims name and address", () => {
    const parsed = locationInputSchema.parse({ name: "  MOT1  ", address: "  1 High St  " });
    expect(parsed).toEqual({ name: "MOT1", address: "1 High St" });
  });

  it("rejects a blank name", () => {
    expect(locationInputSchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("allows a missing address", () => {
    expect(locationInputSchema.parse({ name: "Head Office" }).address).toBeUndefined();
  });
});
