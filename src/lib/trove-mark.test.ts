import { describe, expect, it } from "vitest";
import { contrastRatio, toRgb } from "./brand-color";
import { iconColors, iconHref, iconPlan, uploadedIcons } from "./brand-icon";
import { DEFAULT_ACCENT_DARK, DEFAULT_ACCENT_LIGHT, FACETS, iconSvg, SURFACE_DARK, SURFACE_LIGHT } from "./trove-mark";

const WHITE = { tile: "#123456", gem: "#ffffff" };
const INK = { tile: "#abcdef", gem: "#101317" };

describe("the product mark", () => {
  it("is cut from six facets that between them cover the whole gem", () => {
    expect(FACETS).toHaveLength(6);
    for (const facet of FACETS) {
      expect(facet.d).toMatch(/^M[\d .L]+Z$/);
      expect(facet.opacity).toBeGreaterThan(0);
      expect(facet.opacity).toBeLessThanOrEqual(1);
    }
  });

  it("draws the icon as a tile in the given accent with the gem on it", () => {
    const svg = iconSvg(WHITE);
    expect(svg.startsWith("<svg xmlns=")).toBe(true);
    expect(svg).toContain('rx="7" fill="#123456"');
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).not.toContain("<style>");
    expect(svg.match(/<path /g)).toHaveLength(6);
  });

  it("carries the dark colors as a media query when asked to follow the mode", () => {
    const svg = iconSvg(WHITE, INK);
    expect(svg).toContain("@media (prefers-color-scheme: dark){.t{fill:#abcdef}.g{fill:#101317}}");
    expect(svg).toContain('class="t"');
    expect(svg).toContain('class="g"');
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

describe("the tab icon's colors", () => {
  const bare = { accent: null, altAccent: null, scheme: "light" as const };

  it("are the defaults when nothing is set, with the gem in the color text takes on them", () => {
    expect(iconColors(bare)).toEqual({
      light: { tile: DEFAULT_ACCENT_LIGHT, gem: "#ffffff" },
      dark: { tile: DEFAULT_ACCENT_DARK, gem: "#101317" },
    });
  });

  it("follow the instance's accent and stated text color", () => {
    const colors = iconColors({ ...bare, accent: "#1f6feb", accentText: "#ffff00" });
    expect(colors.light).toEqual({ tile: "#1f6feb", gem: "#ffff00" });
    // Derived from the light accent, readable on dark.
    expect(colors.dark.tile).not.toBe("#1f6feb");
  });

  it("address the icon by its colors, both modes' when they differ", () => {
    expect(iconHref(bare)).toBe("/api/branding/icon?v=0f766effffff-2dd4bf101317");
    // The same accent stated for both modes is one icon.
    expect(iconHref({ ...bare, accent: "#ee2c24", altAccent: "#ee2c24" })).toBe("/api/branding/icon?v=ee2c24101317");
    // A pinned mode or a PNG is one icon whatever the modes do.
    expect(iconHref(bare, "dark")).toBe("/api/branding/icon?mode=dark&v=2dd4bf101317");
    expect(iconHref(bare, undefined, { png: true, size: 180 })).toBe("/api/branding/icon?format=png&size=180&v=0f766effffff");
  });

  it("give way to an uploaded icon, which stands in for both modes until there are two", () => {
    const one = { version: "aaaaaaaaaaaa", mime: "image/png" };
    const two = { version: "bbbbbbbbbbbb", mime: "image/x-icon" };
    expect(uploadedIcons({ ...bare, altIcon: one })).toEqual({ light: one, dark: one });
    expect(iconPlan({ ...bare, icon: one })).toEqual({ type: "image/png", switches: false, light: "iaaaaaaaaaaaa", dark: "iaaaaaaaaaaaa" });
    expect(iconHref({ ...bare, icon: one })).toBe("/api/branding/icon?v=iaaaaaaaaaaaa");
    expect(iconHref({ ...bare, icon: one, altIcon: two })).toBe("/api/branding/icon?v=iaaaaaaaaaaaa-ibbbbbbbbbbbb");
    expect(iconHref({ ...bare, icon: one, altIcon: two }, "dark")).toBe("/api/branding/icon?mode=dark&v=ibbbbbbbbbbbb");
  });
});
