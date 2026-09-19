import { describe, expect, it } from "vitest";
import { searchInputSchema, snippetToSegments } from "./search";

describe("searchInputSchema", () => {
  it("trims the query and applies defaults", () => {
    expect(searchInputSchema.parse({ q: "  fiber  " })).toMatchObject({ q: "fiber", limit: 25 });
  });

  it("caps the page size", () => {
    expect(searchInputSchema.safeParse({ q: "x", limit: 500 }).success).toBe(false);
  });

  it("rejects a company filter that is not an id", () => {
    expect(searchInputSchema.safeParse({ q: "x", companyId: "nope" }).success).toBe(false);
  });
});

describe("snippetToSegments", () => {
  it("splits a headline into plain and matched runs", () => {
    expect(snippetToSegments("core <mark>switch</mark> rack")).toEqual([
      { text: "core ", match: false },
      { text: "switch", match: true },
      { text: " rack", match: false },
    ]);
  });

  it("handles several matches", () => {
    const segments = snippetToSegments("<mark>a</mark> and <mark>b</mark>");
    expect(segments.filter((s) => s.match).map((s) => s.text)).toEqual(["a", "b"]);
  });

  it("returns one plain run when nothing matched", () => {
    expect(snippetToSegments("nothing here")).toEqual([{ text: "nothing here", match: false }]);
  });

  it("does not treat other markup as a match", () => {
    const segments = snippetToSegments("<script>alert(1)</script>");
    expect(segments).toEqual([{ text: "<script>alert(1)</script>", match: false }]);
  });
});
