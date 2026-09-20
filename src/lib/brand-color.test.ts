import { describe, expect, it } from "vitest";
import { brandTokens, contrastRatio, luminance, normalizeHex, readableOn, toRgb } from "./brand-color";

const WHITE = { r: 255, g: 255, b: 255 };
const DARK = { r: 30, g: 33, b: 41 };

describe("normalizeHex", () => {
  it("accepts both lengths and normalizes case", () => {
    expect(normalizeHex("#1F6FEB")).toBe("#1f6feb");
    expect(normalizeHex("  #abc ")).toBe("#aabbcc");
  });

  it("refuses anything that is not a hex color", () => {
    for (const value of ["red", "#12", "#1234567", "rgb(1,2,3)", "", "#12345g", "javascript:x"]) {
      expect(normalizeHex(value)).toBeNull();
    }
  });
});

describe("luminance and contrast", () => {
  it("matches the WCAG reference points", () => {
    expect(luminance(WHITE)).toBeCloseTo(1, 5);
    expect(luminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 5);
    expect(contrastRatio(WHITE, { r: 0, g: 0, b: 0 })).toBeCloseTo(21, 2);
  });

  it("is order independent", () => {
    const a = toRgb("#1f6feb");
    if (!a) throw new Error("unparsed");
    expect(contrastRatio(a, WHITE)).toBeCloseTo(contrastRatio(WHITE, a), 10);
  });
});

describe("readableOn", () => {
  it("puts white on a dark brand and near-black on a light one", () => {
    expect(readableOn({ r: 20, g: 30, b: 90 })).toBe("#ffffff");
    expect(readableOn({ r: 250, g: 220, b: 60 })).toBe("#101317");
  });
});

describe("brandTokens", () => {
  it("returns null for anything unparseable, so the palette stands", () => {
    expect(brandTokens(null)).toBeNull();
    expect(brandTokens("")).toBeNull();
    expect(brandTokens("var(--primary)")).toBeNull();
  });

  it("keeps a color that already works on both surfaces", () => {
    const tokens = brandTokens("#1f6feb");
    expect(tokens).not.toBeNull();
    expect(tokens?.light).toBe("#1f6feb");
  });

  it("lightens a near-black brand until it reads on a dark background", () => {
    const tokens = brandTokens("#000000");
    if (!tokens) throw new Error("unparsed");

    const dark = toRgb(tokens.dark);
    if (!dark) throw new Error("unparsed");
    expect(contrastRatio(dark, DARK)).toBeGreaterThanOrEqual(4.5);
  });

  it("lightens a navy brand for the mode it was not stated for", () => {
    // Stated for light, where navy is fine; the dark mode is ours to derive.
    const tokens = brandTokens({ accent: "#0b1b3a", scheme: "light" });
    if (!tokens) throw new Error("unparsed");

    expect(tokens.light).toBe("#0b1b3a");
    const dark = toRgb(tokens.dark);
    if (!dark) throw new Error("unparsed");
    expect(contrastRatio(dark, DARK)).toBeGreaterThanOrEqual(4.5);
  });

  it("gives every surface a readable label on the accent itself", () => {
    for (const input of ["#1f6feb", "#facc15", "#000000", "#ffffff", "#b4381c"]) {
      const tokens = brandTokens(input);
      if (!tokens) throw new Error("unparsed");

      for (const [accent, label] of [
        [tokens.light, tokens.onLight],
        [tokens.dark, tokens.onDark],
      ] as const) {
        const a = toRgb(accent);
        const b = toRgb(label);
        if (!a || !b) throw new Error("unparsed");
        expect(contrastRatio(a, b)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe("brandTokens with a mode declared", () => {
  it("uses a stated color in its own mode exactly as given", () => {
    // Near-white would be adapted if we were guessing, but the operator says
    // it is the dark mode color, and on a dark surface it is right.
    const tokens = brandTokens({ accent: "#fffdf0", scheme: "dark" });
    expect(tokens?.dark).toBe("#fffdf0");
    // The light mode is ours to derive, and near-white on white is not usable.
    const light = toRgb(tokens?.light ?? "");
    if (!light) throw new Error("unparsed");
    expect(contrastRatio(light, { r: 255, g: 255, b: 255 })).toBeGreaterThanOrEqual(4.5);
  });

  it("takes an exact color for each mode when both are given", () => {
    const tokens = brandTokens({
      accent: "#1f6feb",
      scheme: "light",
      altAccent: "#7cc4ff",
    });
    expect(tokens?.light).toBe("#1f6feb");
    expect(tokens?.dark).toBe("#7cc4ff");
  });

  it("derives the mode that was not stated", () => {
    const only = brandTokens({ accent: "#000000", scheme: "light" });
    expect(only?.light).toBe("#000000");
    // Black would vanish on a dark background, so the derived one does not.
    expect(only?.dark).not.toBe("#000000");
    const dark = toRgb(only?.dark ?? "");
    if (!dark) throw new Error("unparsed");
    expect(contrastRatio(dark, DARK)).toBeGreaterThanOrEqual(4.5);
  });

  it("works from the alternate alone, which is a half-finished brand", () => {
    const tokens = brandTokens({ accent: null, scheme: "light", altAccent: "#7cc4ff" });
    expect(tokens?.dark).toBe("#7cc4ff");
    expect(tokens?.light).toBeTruthy();
  });

  it("is still null when nothing usable was given", () => {
    expect(brandTokens({ accent: null, altAccent: null })).toBeNull();
    expect(brandTokens({ accent: "nonsense", altAccent: "" })).toBeNull();
  });

  it("keeps the old single-color call working", () => {
    expect(brandTokens("#1f6feb")?.light).toBe("#1f6feb");
  });
});
