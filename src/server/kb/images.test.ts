import { describe, expect, it } from "vitest";
import { localPath, referencedPaths, rewriteReferences } from "./images";

const stored = (known: Record<string, string>) => (path: string) => known[path] ?? null;

describe("localPath", () => {
  it("resolves beside the article", () => {
    expect(localPath("guides/pumps/priming.md", "pump.png")).toBe("guides/pumps/pump.png");
    expect(localPath("guides/pumps/priming.md", "./img/pump.png")).toBe("guides/pumps/img/pump.png");
    expect(localPath("guides/priming.md", "../images/pump.png")).toBe("images/pump.png");
  });

  it("resolves from the top when the article has no path", () => {
    expect(localPath(null, "images/pump.png")).toBe("images/pump.png");
  });

  it("decodes what was encoded and drops a query", () => {
    expect(localPath("a/b.md", "../images/Rear%20axle.bmp?raw=1#top")).toBe("images/Rear axle.bmp");
    expect(localPath("a/b.md", "<../images/Rear axle.bmp>")).toBe("images/Rear axle.bmp");
  });

  it("keeps a stray percent sign as part of the name", () => {
    expect(localPath("a.md", "100%.png")).toBe("100%.png");
  });

  it("refuses what points anywhere else", () => {
    expect(localPath("a/b.md", "https://example.com/pump.png")).toBeNull();
    expect(localPath("a/b.md", "data:image/png;base64,AAAA")).toBeNull();
    expect(localPath("a/b.md", "//example.com/pump.png")).toBeNull();
    expect(localPath("a/b.md", "/api/branding/logo")).toBeNull();
    expect(localPath("a/b.md", "#fitting")).toBeNull();
    expect(localPath("a/b.md", "")).toBeNull();
  });

  it("refuses to climb above the top of the import", () => {
    expect(localPath("a/b.md", "../../etc/passwd")).toBeNull();
    expect(localPath(null, "../pump.png")).toBeNull();
  });
});

describe("rewriteReferences", () => {
  it("points a picture at where it is kept", () => {
    const out = rewriteReferences(
      "Before\n\n![The pump](../images/pump.png)\n\nAfter",
      "guides/priming.md",
      stored({ "images/pump.png": "/img/1" }),
    );
    expect(out).toBe("Before\n\n![The pump](/img/1)\n\nAfter");
  });

  it("reads a destination with spaces and brackets in it", () => {
    const out = rewriteReferences(
      "![Actuator (2 wire)](../images/Door Lock/Actuator (2 wire) w15f.jpg)",
      "doors/lock.md",
      stored({ "images/Door Lock/Actuator (2 wire) w15f.jpg": "/img/2" }),
    );
    expect(out).toBe("![Actuator (2 wire)](/img/2)");
  });

  it("keeps a title", () => {
    const out = rewriteReferences(
      '![Pump](pump.png "The old pump")',
      "a.md",
      stored({ "pump.png": "/img/3" }),
    );
    expect(out).toBe('![Pump](/img/3 "The old pump")');
  });

  it("leaves the caption where the picture did not come with the import", () => {
    expect(rewriteReferences("See ![the seal](../images/seal 2.JPG) here", "a/b.md", stored({}))).toBe(
      "See the seal here",
    );
  });

  it("leaves a picture on another site alone", () => {
    const text = "![Logo](https://example.com/logo.png)";
    expect(rewriteReferences(text, "a.md", stored({}))).toBe(text);
  });

  it("rewrites a picture that is a link, and the link when it is a picture too", () => {
    const out = rewriteReferences(
      "[![Small](thumbs/pump.png)](full/pump.png)",
      "a.md",
      stored({ "thumbs/pump.png": "/img/4", "full/pump.png": "/img/5" }),
    );
    expect(out).toBe("[![Small](/img/4)](/img/5)");
  });

  it("leaves a link to something that is not stored alone", () => {
    const text = "[The manual](../Documents/manual.html) and [a site](https://example.com)";
    expect(rewriteReferences(text, "a/b.md", stored({}))).toBe(text);
  });

  it("does not follow what is inside fenced code", () => {
    const text = "```\n![Pump](pump.png)\n```\n\n![Pump](pump.png)";
    expect(rewriteReferences(text, "a.md", stored({ "pump.png": "/img/6" }))).toBe(
      "```\n![Pump](pump.png)\n```\n\n![Pump](/img/6)",
    );
  });

  it("leaves brackets that are not references alone", () => {
    const text = "An array [1, 2] and a note [sic] (really) and an unclosed [one";
    expect(rewriteReferences(text, "a.md", stored({}))).toBe(text);
  });
});

describe("referencedPaths", () => {
  it("lists each local path once", () => {
    expect(
      referencedPaths(
        "![a](../images/a.png) ![again](../images/a.png) ![b](b.png) ![c](https://example.com/c.png)",
        "guides/x.md",
      ),
    ).toEqual(["images/a.png", "guides/b.png"]);
  });
});
