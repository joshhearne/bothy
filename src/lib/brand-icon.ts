import { brandTokens, type BrandTokens } from "@/lib/brand-color";
import { DEFAULT_ACCENT_DARK, DEFAULT_ACCENT_LIGHT, type IconColors } from "@/lib/trove-mark";

/** An uploaded tab icon as the page needs to know it: a version and a type. */
export type UploadedIcon = { version: string; mime: string };

/** The part of branding the tab icon is made from. */
export type IconBranding = {
  accent: string | null;
  altAccent: string | null;
  scheme: "light" | "dark";
  accentText?: string | null;
  altAccentText?: string | null;
  /** The operator's own icons, per mode, when uploaded. */
  icon?: UploadedIcon | null;
  altIcon?: UploadedIcon | null;
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

/**
 * The uploaded icon each mode shows: its own, or the other mode's when only
 * one was uploaded. Null in both when the mark is the icon.
 */
export function uploadedIcons(branding: IconBranding): { light: UploadedIcon | null; dark: UploadedIcon | null } {
  const light = branding.icon ?? branding.altIcon ?? null;
  const dark = branding.altIcon ?? branding.icon ?? null;
  return { light, dark };
}

const version = (colors: IconColors) => colors.tile.slice(1) + colors.gem.slice(1);

/**
 * What the tab wants: one icon for both modes, or one per mode. With
 * uploads, each mode's own; without, the mark in each mode's colours.
 */
export function iconPlan(branding: IconBranding): {
  /** The light icon's type, for the link that names it; the SVG mark otherwise. */
  type: string;
  /** Whether the modes differ, so the switching SVG is worth listing. */
  switches: boolean;
  /** The version each address carries. */
  light: string;
  dark: string;
} {
  const uploaded = uploadedIcons(branding);
  if (uploaded.light && uploaded.dark) {
    return {
      type: uploaded.light.mime,
      switches: uploaded.light.version !== uploaded.dark.version,
      // The version is a slice of a uuid; its hyphen would read as the separator.
      light: `i${uploaded.light.version.replace(/-/g, "")}`,
      dark: `i${uploaded.dark.version.replace(/-/g, "")}`,
    };
  }
  const colors = iconColors(branding);
  return {
    type: "image/svg+xml",
    switches: iconDiffers(colors),
    light: version(colors.light),
    dark: version(colors.dark),
  };
}

/**
 * The address of the tab icon, or of the icon one mode would show. The
 * version is the icon itself — its colours, or the upload's key — so a
 * cached icon is this exact icon and a change is a new address. The SVG
 * with no mode pinned is the one for the tab: it carries both modes when
 * they differ, and the browser picks.
 */
export function iconHref(
  branding: IconBranding,
  mode?: "light" | "dark",
  format?: { png: true; size: number },
): string {
  const plan = iconPlan(branding);
  const params = new URLSearchParams();
  if (format) {
    params.set("format", "png");
    params.set("size", String(format.size));
  }
  if (mode) params.set("mode", mode);
  const both = !mode && !format && plan.switches;
  params.set("v", both ? `${plan.light}-${plan.dark}` : mode === "dark" ? plan.dark : plan.light);
  return `/api/branding/icon?${params.toString()}`;
}
