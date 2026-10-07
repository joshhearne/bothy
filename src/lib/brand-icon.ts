import { brandTokens, type BrandTokens } from "@/lib/brand-color";
import { DEFAULT_ACCENT_DARK, DEFAULT_ACCENT_LIGHT, type IconColors } from "@/lib/trove-mark";

/** The part of branding the tab icon is made from. */
export type IconBranding = {
  accent: string | null;
  altAccent: string | null;
  scheme: "light" | "dark";
  accentText?: string | null;
  altAccentText?: string | null;
};

/**
 * The tile and gem colours for each mode: the accent, and the text colour the
 * interface puts on it, which is what a mark on a tile wants too. Already
 * normalized hex, or the defaults; never what someone typed.
 */
export function iconColors(branding: IconBranding): { light: IconColors; dark: IconColors } {
  const tokens: BrandTokens = brandTokens(branding) ?? {
    light: DEFAULT_ACCENT_LIGHT,
    dark: DEFAULT_ACCENT_DARK,
    onLight: "#ffffff",
    onDark: "#101317",
  };
  return {
    light: { tile: tokens.light, gem: tokens.onLight },
    dark: { tile: tokens.dark, gem: tokens.onDark },
  };
}

/** Whether the two modes want different icons at all. */
export function iconDiffers(colors: { light: IconColors; dark: IconColors }): boolean {
  return colors.light.tile !== colors.dark.tile || colors.light.gem !== colors.dark.gem;
}

const version = (colors: IconColors) => colors.tile.slice(1) + colors.gem.slice(1);

/**
 * The address of the tab icon, or of the icon one mode would show. The
 * version is the colours themselves, so a cached icon is this exact icon and
 * a changed accent is a new address. The SVG with no mode pinned is the one
 * for the tab: it names both modes' colours when they differ, and the
 * browser picks.
 */
export function iconHref(
  branding: IconBranding,
  mode?: "light" | "dark",
  format?: { png: true; size: number },
): string {
  const colors = iconColors(branding);
  const params = new URLSearchParams();
  if (format) {
    params.set("format", "png");
    params.set("size", String(format.size));
  }
  if (mode) params.set("mode", mode);
  const both = !mode && !format && iconDiffers(colors);
  params.set(
    "v",
    both ? `${version(colors.light)}-${version(colors.dark)}` : version(mode === "dark" ? colors.dark : colors.light),
  );
  return `/api/branding/icon?${params.toString()}`;
}
