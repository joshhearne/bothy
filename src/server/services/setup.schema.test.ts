import { describe, expect, it } from "vitest";
import { firstAdminSchema } from "./setup";

const valid = {
  name: "Ada Lovelace",
  email: "Ada@Example.COM",
  password: "a-sufficiently-long-password",
};

describe("firstAdminSchema", () => {
  it("accepts a valid admin and lowercases the email", () => {
    const parsed = firstAdminSchema.parse(valid);
    expect(parsed.email).toBe("ada@example.com");
  });

  it("trims the name", () => {
    expect(firstAdminSchema.parse({ ...valid, name: "  Ada  " }).name).toBe("Ada");
  });

  it("rejects an empty name", () => {
    expect(firstAdminSchema.safeParse({ ...valid, name: "   " }).success).toBe(false);
  });

  it("rejects a malformed email", () => {
    expect(firstAdminSchema.safeParse({ ...valid, email: "ada@" }).success).toBe(false);
  });

  it("rejects an empty password; the policy judges the rest", () => {
    expect(firstAdminSchema.safeParse({ ...valid, password: "" }).success).toBe(false);
    expect(firstAdminSchema.safeParse({ ...valid, password: "x".repeat(129) }).success).toBe(false);
  });
});
