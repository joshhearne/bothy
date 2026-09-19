import { describe, expect, it } from "vitest";
import { plural } from "./utils";

describe("plural", () => {
  it("uses the singular for one", () => {
    expect(plural(1, "location")).toBe("1 location");
  });

  it("uses the plural for zero and many", () => {
    expect(plural(0, "location")).toBe("0 locations");
    expect(plural(2, "document")).toBe("2 documents");
  });

  it("accepts an irregular plural", () => {
    expect(plural(2, "entry", "entries")).toBe("2 entries");
  });
});
