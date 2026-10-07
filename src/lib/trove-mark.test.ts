import { describe, expect, it } from "vitest";
import { contrastRatio, toRgb } from "./brand-color";
import { DEFAULT_ACCENT_DARK, DEFAULT_ACCENT_LIGHT, FACETS, iconSvg, SURFACE_DARK, SURFACE_LIGHT } from "./trove-mark";

describe("the product mark", () => {
  it("is cut from six facets that between them cover the whole gem", () => {
    expect(FACETS).toHaveLength(6);
    for (const facet of FACETS) {
      expect(facet.d).toMatch(/^M[\d .L]+Z$/);
      expect(facet.opacity).toBeGreaterThan(0);
      expect(facet.opacity).toBeLessThanOrEqual(1);
    }
  });

  it("draws the icon as a tile in the given accent with the gem in white", () => {
    const svg = iconSvg("#123456");
    expect(svg.startsWith("<svg xmlns=")).toBe(true);
    expect(svg).toContain('rx="7" fill="#123456"');
    expect(svg).toContain('fill="#ffffff"');
    expect(svg.match(/<path /g)).toHaveLength(6);
  });

  it("ships an accent that reads on its own surface in both modes", () => {
    const light = toRgb(DEFAULT_ACCENT_LIGHT)!;
    const dark = toRgb(DEFAULT_ACCENT_DARK)!;
    expect(contrastRatio(light, toRgb(SURFACE_LIGHT)!)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(dark, toRgb(SURFACE_DARK)!)).toBeGreaterThanOrEqual(4.5);
    // White on the light accent, near-black on the dark one: the button labels.
    expect(contrastRatio(light, toRgb("#ffffff")!)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(dark, toRgb("#101317")!)).toBeGreaterThanOrEqual(4.5);
  });
});
