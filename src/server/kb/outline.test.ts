import { describe, expect, it } from "vitest";
import { outlineHtml } from "./outline";

describe("outlineHtml", () => {
  it("gives every heading an id of ours and lists them, depth relative to the shallowest", () => {
    const html = '<h2 id="theirs">Setup &amp; care</h2><p>a</p><h3>Step <em>one</em></h3><h2>Use</h2>';
    const result = outlineHtml(html);
    expect(result.outline).toEqual([
      { id: "section-1", level: 1, text: "Setup & care" },
      { id: "section-2", level: 2, text: "Step one" },
      { id: "section-3", level: 1, text: "Use" },
    ]);
    expect(result.html).toBe(
      '<h2 id="section-1">Setup &amp; care</h2><p>a</p><h3 id="section-2">Step <em>one</em></h3><h2 id="section-3">Use</h2>',
    );
  });

  it("makes no outline from a single heading or none", () => {
    expect(outlineHtml("<h2>Only</h2><p>text</p>")).toEqual({ html: "<h2>Only</h2><p>text</p>", outline: [] });
    expect(outlineHtml("<p>text</p>").outline).toEqual([]);
  });

  it("skips an empty heading", () => {
    expect(outlineHtml("<h2></h2><h2>A</h2><h2>B</h2>").outline.map((item) => item.text)).toEqual(["A", "B"]);
  });
});
