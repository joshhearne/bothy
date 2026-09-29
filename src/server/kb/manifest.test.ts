import { describe, expect, it } from "vitest";
import { normalizePath, parseManifest, sameInstant } from "./manifest";

describe("parseManifest", () => {
  it("reads a list keyed by id and path", () => {
    const manifest = parseManifest(
      JSON.stringify([
        {
          id: 4821,
          path: "articles/Networking/VPN/tunnels-4821.md",
          date_modified: "2025-11-11T21:40:52.147Z",
        },
      ]),
    );
    expect(manifest?.size).toBe(1);
    expect(manifest?.byId.get("4821")?.dateModified.toISOString()).toBe(
      "2025-11-11T21:40:52.147Z",
    );
    expect(manifest?.byPath.has("articles/Networking/VPN/tunnels-4821.md")).toBe(true);
  });

  it("reads a list held under a name", () => {
    const manifest = parseManifest(
      JSON.stringify({ generated: "2026-08-11", articles: [{ article_id: "a1", modified: "2026-01-02" }] }),
    );
    expect(manifest?.byId.has("a1")).toBe(true);
  });

  it("reads an object keyed by path", () => {
    const manifest = parseManifest(
      JSON.stringify({ "docs\\setup.md": { date_modified: "2026-01-02" } }),
    );
    expect(manifest?.byPath.has("docs/setup.md")).toBe(true);
  });

  it("passes over entries with no date", () => {
    expect(parseManifest(JSON.stringify([{ id: 1, path: "a.md" }]))).toBeNull();
  });

  it("answers null for what is not a manifest", () => {
    expect(parseManifest("not json")).toBeNull();
    expect(parseManifest("42")).toBeNull();
    expect(parseManifest("[]")).toBeNull();
  });
});

describe("normalizePath", () => {
  it("uses forward slashes and no leading slash", () => {
    expect(normalizePath(".\\articles\\a.md")).toBe("articles/a.md");
    expect(normalizePath("/articles/a.md")).toBe("articles/a.md");
  });
});

describe("sameInstant", () => {
  it("compares to the second", () => {
    expect(sameInstant(new Date("2025-01-01T00:00:00.147Z"), new Date("2025-01-01T00:00:00.000Z"))).toBe(true);
    expect(sameInstant(new Date("2025-01-01T00:00:01Z"), new Date("2025-01-01T00:00:00Z"))).toBe(false);
  });

  it("never matches a missing date", () => {
    expect(sameInstant(null, null)).toBe(false);
  });
});
