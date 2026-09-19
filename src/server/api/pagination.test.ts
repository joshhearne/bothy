import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor, parseLimit, toPage } from "./pagination";

describe("parseLimit", () => {
  it("defaults when absent or nonsense", () => {
    expect(parseLimit(null)).toBe(50);
    expect(parseLimit("abc")).toBe(50);
    expect(parseLimit("0")).toBe(50);
  });

  it("honors a sensible limit", () => {
    expect(parseLimit("10")).toBe(10);
  });

  it("caps the limit", () => {
    expect(parseLimit("10000")).toBe(200);
  });
});

describe("cursors", () => {
  it("round-trips", () => {
    const cursor = encodeCursor({ sort: "Acme", id: "abc" });
    expect(decodeCursor(cursor)).toEqual({ sort: "Acme", id: "abc" });
  });

  it("is opaque", () => {
    expect(encodeCursor({ sort: "Acme", id: "abc" })).not.toContain("Acme");
  });

  it("treats a malformed cursor as no cursor", () => {
    expect(decodeCursor("not-base64!!")).toBeNull();
    expect(decodeCursor(Buffer.from('{"nope":1}').toString("base64url"))).toBeNull();
    expect(decodeCursor(null)).toBeNull();
  });
});

describe("toPage", () => {
  const rows = [
    { id: "1", name: "a" },
    { id: "2", name: "b" },
    { id: "3", name: "c" },
  ];

  it("returns no cursor when the page is not full", () => {
    const page = toPage(rows, 5, (row) => row.name);
    expect(page.data).toHaveLength(3);
    expect(page.next_cursor).toBeNull();
  });

  it("trims the over-fetched row and points at the next page", () => {
    const page = toPage(rows, 2, (row) => row.name);
    expect(page.data.map((row) => row.id)).toEqual(["1", "2"]);
    expect(decodeCursor(page.next_cursor)).toEqual({ sort: "b", id: "2" });
  });
});
