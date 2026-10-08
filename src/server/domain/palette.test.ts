import { describe, expect, it } from "vitest";
import {
  colorsInCss,
  colorsInValue,
  isNeutral,
  rankPalette,
  weightOf,
} from "./palette";

describe("colorsInValue", () => {
  it("reads hex in every length, rgb() and hsl() in both syntaxes", () => {
    expect(colorsInValue("#abc #aabbcc #aabbccff #aabbcc10")).toEqual([
      "#aabbcc",
      "#aabbcc",
      "#aabbcc",
    ]);
    expect(colorsInValue("rgb(238, 44, 36) rgba(0,0,0,0.2) rgb(10 127 90 / 80%)")).toEqual([
      "#ee2c24",
      "#0a7f5a",
    ]);
    expect(colorsInValue("hsl(0, 100%, 50%) hsla(120 100% 25% / .1)")).toEqual(["#ff0000"]);
  });
});

describe("weightOf", () => {
  it("rates a brand-named custom property highest, a shadow not at all", () => {
    expect(weightOf("--color-primary")).toBe(8);
    expect(weightOf("--brand")).toBe(8);
    expect(weightOf("--spacing-color")).toBe(2);
    expect(weightOf("background-color")).toBe(1);
    expect(weightOf("fill")).toBe(1);
    expect(weightOf("box-shadow")).toBe(0);
    expect(weightOf("transition")).toBe(0);
  });
});

describe("isNeutral", () => {
  it("counts white, black and greys as paper and ink, not a hue", () => {
    expect(isNeutral("#ffffff")).toBe(true);
    expect(isNeutral("#000000")).toBe(true);
    expect(isNeutral("#808080")).toBe(true);
    expect(isNeutral("#f8f9fa")).toBe(true);
    expect(isNeutral("#ee2c24")).toBe(false);
    expect(isNeutral("#0f766e")).toBe(false);
  });
});

describe("rankPalette", () => {
  it("puts the colours a site paints with first, leaving out its paper, ink and the browser's links", () => {
    const css = `
      :root { --color-primary: #ee2c24; --muted: #6b7280; }
      body { color: #111111; background: #ffffff; }
      a { color: #0000ee; }
      a:visited { color: #551a8b; }
      .btn { background-color: #ee2c24; color: #fff; }
      .btn:hover { background-color: #e02a22; }
      .accent { border-color: rgb(15, 118, 110); }
      .card { box-shadow: 0 0 0 1px #123456; }
    `;
    expect(rankPalette(colorsInCss(css))).toEqual(["#ee2c24", "#0f766e"]);
  });

  it("falls back to black and white when that is all a site uses", () => {
    const css = `body { color: #000; background: #fff; } a { color: #0000ee; }`;
    expect(rankPalette(colorsInCss(css))).toEqual(["#000000", "#ffffff"]);
  });

  it("gives nothing for a stylesheet with no colour in it", () => {
    expect(rankPalette(colorsInCss(`body { margin: 0 }`))).toEqual([]);
  });
});
