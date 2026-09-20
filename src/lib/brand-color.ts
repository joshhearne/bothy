/**
 * A brand color arrives as a hex string and has to survive both palettes: as a
 * button fill that text sits on, and as a link color on the page background.
 * Everything here is sRGB math from WCAG 2.1, so the numbers are checkable.
 *
 * Nothing in this file trusts its input. A color that does not parse is null,
 * and the interface falls back to its own palette rather than emitting whatever
 * was typed into a stylesheet.
 */

export type Rgb = { r: number; g: number; b: number };

/** The two surfaces an accent has to work against, from globals.css. */
const LIGHT_SURFACE: Rgb = { r: 255, g: 255, b: 255 };
const DARK_SURFACE: Rgb = { r: 30, g: 33, b: 41 };

/** WCAG AA for normal text, which is the bar an accent has to clear. */
const MIN_CONTRAST = 4.5;

export function normalizeHex(input: string): string | null {
  const value = input.trim().toLowerCase();
  const short = /^#([0-9a-f]{3})$/.exec(value);
  if (short?.[1]) {
    const [r, g, b] = [...short[1]];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return /^#[0-9a-f]{6}$/.test(value) ? value : null;
}

export function toRgb(hex: string): Rgb | null {
  const normalized = normalizeHex(hex);
  if (!normalized) return null;
  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16),
  };
}

function toHex({ r, g, b }: Rgb): string {
  const part = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

/** WCAG relative luminance. */
export function luminance({ r, g, b }: Rgb): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
}

function mix(color: Rgb, toward: Rgb, amount: number): Rgb {
  return {
    r: color.r + (toward.r - color.r) * amount,
    g: color.g + (toward.g - color.g) * amount,
    b: color.b + (toward.b - color.b) * amount,
  };
}

/** Black or white, whichever is readable on this color. */
export function readableOn(color: Rgb): string {
  const onWhite = contrastRatio(color, LIGHT_SURFACE);
  const onNearBlack = contrastRatio(color, NEAR_BLACK);
  return onWhite >= onNearBlack ? "#ffffff" : "#101317";
}

const BLACK: Rgb = { r: 0, g: 0, b: 0 };
const NEAR_BLACK: Rgb = { r: 16, g: 19, b: 23 };

/**
 * An accent has two jobs at once: it is link text on the page, and it is the
 * fill behind a button's label. A mid-tone can satisfy the first and fail the
 * second — grey reads against white but nothing reads on grey — so both are
 * required here.
 */
function isUsable(color: Rgb, surface: Rgb): boolean {
  const againstSurface = contrastRatio(color, surface);
  const bestLabel = Math.max(
    contrastRatio(color, LIGHT_SURFACE),
    contrastRatio(color, NEAR_BLACK),
  );
  return againstSurface >= MIN_CONTRAST && bestLabel >= MIN_CONTRAST;
}

/**
 * Nudges a color away from a surface until it is usable against it. A brand
 * navy is invisible on a dark background and a brand yellow is invisible on a
 * light one; this keeps either usable without asking for two colors.
 *
 * Moving away from the surface improves both tests at once, so the walk is
 * monotonic and stops at the first colour that works.
 */
function adjustFor(color: Rgb, surface: Rgb): Rgb {
  const away = luminance(surface) > 0.5 ? BLACK : LIGHT_SURFACE;
  let candidate = color;

  // 5% of the remaining distance, far enough to cross from white to near-black.
  for (let step = 0; step < 48; step += 1) {
    if (isUsable(candidate, surface)) return candidate;
    candidate = mix(candidate, away, 0.05);
  }
  return candidate;
}

export type BrandTokens = {
  /** The accent as it should appear on each surface. */
  light: string;
  dark: string;
  /** Text that sits on the accent itself, per surface. */
  onLight: string;
  onDark: string;
};

/**
 * The brand as an operator states it: a color, which mode it was drawn for,
 * and optionally the exact color to use in the other mode.
 */
export type BrandInput = {
  accent: string | null | undefined;
  /** Which mode `accent` belongs to. */
  scheme?: "light" | "dark";
  /** The color for the other mode. Derived from `accent` when absent. */
  altAccent?: string | null | undefined;
};

/**
 * The four values the interface needs from a brand. A color given for a mode
 * is used in that mode exactly as given, on the operator's word that it works
 * there; a mode with no color of its own gets one derived from the other, far
 * enough from that surface to stay readable.
 *
 * Returns null when there is no usable color at all, which is the caller's
 * signal to leave the built-in palette alone.
 */
export function brandTokens(input: string | null | undefined | BrandInput): BrandTokens | null {
  const brand: BrandInput = typeof input === "object" && input !== null ? input : { accent: input };
  const scheme = brand.scheme === "dark" ? "dark" : "light";

  const primary = toRgb(brand.accent ?? "");
  const alternate = toRgb(brand.altAccent ?? "");
  if (!primary && !alternate) return null;

  // The stated color belongs to its own mode; the other is the alternate.
  const statedLight = scheme === "light" ? primary : alternate;
  const statedDark = scheme === "light" ? alternate : primary;

  // With only one color, the other mode derives from it rather than going bare.
  const light = statedLight ?? adjustFor(statedDark as Rgb, LIGHT_SURFACE);
  const dark = statedDark ?? adjustFor(statedLight as Rgb, DARK_SURFACE);

  return {
    light: toHex(light),
    dark: toHex(dark),
    onLight: readableOn(light),
    onDark: readableOn(dark),
  };
}
