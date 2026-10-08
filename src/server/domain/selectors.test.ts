import { describe, expect, it } from "vitest";
import { parseSelectors } from "./run";

describe("parseSelectors", () => {
  it("splits on commas and spaces, lowercases, drops what is not a selector, and dedupes", () => {
    expect(parseSelectors(" Selector1, ppe-1 bad!sel  selector1 ")).toEqual([
      "selector1",
      "ppe-1",
    ]);
  });

  it("gives nothing for nothing", () => {
    expect(parseSelectors(null)).toEqual([]);
    expect(parseSelectors("")).toEqual([]);
  });
});
