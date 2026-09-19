import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatNumber, plural } from "./format";

describe("formatDate", () => {
  it("uses the American order by default", () => {
    expect(formatDate("2026-03-01")).toBe("Mar 1, 2026");
  });

  it("uses the British order for en-GB", () => {
    expect(formatDate("2026-03-01", "en-GB")).toBe("1 Mar 2026");
  });

  it("never drifts across a timezone boundary", () => {
    expect(formatDate("2026-01-01")).toContain("Jan 1");
    expect(formatDate("2026-01-01", "en-GB")).toContain("1 Jan");
  });

  it("returns the input when it is not a date", () => {
    expect(formatDate("nonsense")).toBe("nonsense");
  });
});

describe("formatDateTime", () => {
  it("differs between the two locales", () => {
    const when = new Date("2026-03-01T15:30:00Z");
    expect(formatDateTime(when, "en-US")).not.toBe(formatDateTime(when, "en-GB"));
  });
});

describe("formatNumber", () => {
  it("groups thousands", () => {
    expect(formatNumber(1234567)).toBe("1,234,567");
    expect(formatNumber(1234567, "en-GB")).toBe("1,234,567");
  });
});

describe("plural", () => {
  it("picks the singular for one", () => {
    expect(plural(1, "location", "locations")).toBe("1 location");
  });

  it("picks the plural otherwise", () => {
    expect(plural(0, "location", "locations")).toBe("0 locations");
    expect(plural(2, "document", "documents")).toBe("2 documents");
  });

  it("formats large counts", () => {
    expect(plural(1500, "result", "results")).toBe("1,500 results");
  });
});
