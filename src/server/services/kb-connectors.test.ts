import { describe, expect, it } from "vitest";
import { canonical, connectorInputSchema, underPrefix } from "./kb-connectors";

describe("underPrefix", () => {
  const prefix = "https://kb.example.com/docs";

  it("accepts pages at and beneath the prefix", () => {
    expect(underPrefix("https://kb.example.com/docs", prefix)).toBe(true);
    expect(underPrefix("https://kb.example.com/docs/setup/a", prefix)).toBe(true);
  });

  it("refuses a sibling that only shares the letters", () => {
    expect(underPrefix("https://kb.example.com/docs-internal/a", prefix)).toBe(false);
  });

  it("refuses another site, another port, and another scheme", () => {
    expect(underPrefix("https://evil.example.com/docs/a", prefix)).toBe(false);
    expect(underPrefix("https://kb.example.com:8443/docs/a", prefix)).toBe(false);
    expect(underPrefix("http://kb.example.com/docs/a", prefix)).toBe(false);
  });
});

describe("canonical", () => {
  it("gives one address to one page", () => {
    expect(canonical("https://kb.example.com/a/#top")).toBe("https://kb.example.com/a");
    expect(canonical("https://kb.example.com/")).toBe("https://kb.example.com/");
  });
});

describe("connectorInputSchema", () => {
  const base = { collectionId: "0b8f6c1e-3a5d-4c7b-9e2f-1a2b3c4d5e6f", kind: "sitemap" };

  it("accepts a web address and applies defaults", () => {
    const parsed = connectorInputSchema.parse({ ...base, url: "https://kb.example.com/sitemap.xml" });
    expect(parsed).toMatchObject({ intervalHours: 168, maxPages: 500 });
  });

  it("refuses anything that is not http or https", () => {
    for (const url of ["file:///etc/passwd", "ftp://example.com/", "javascript:alert(1)", "kb"]) {
      expect(connectorInputSchema.safeParse({ ...base, url }).success).toBe(false);
    }
  });

  it("refuses an address that carries credentials", () => {
    expect(
      connectorInputSchema.safeParse({ ...base, url: "https://user:pass@kb.example.com/" }).success,
    ).toBe(false);
  });
});
