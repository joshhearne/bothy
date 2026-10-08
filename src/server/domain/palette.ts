/**
 * The colours a site actually paints with, read from its stylesheets. The
 * head's theme-color is what a site says; its CSS is what it does, and many
 * sites say nothing. Pure text work on other people's CSS: bounded, tolerant,
 * never executed.
 */

import { toRgb, type Rgb } from "@/lib/brand-color";

/** More than this and it is not a stylesheet worth reading. */
export const MAX_CSS_BYTES = 512 * 1024;

/** Browsers' own link colours: on a page by default, not by design. */
const DEFAULT_LINK_COLORS = new Set(["#0000ee", "#551a8b", "#0000ff", "#800080"]);

const part = (n: number) =>
  Math.max(0, Math.min(255, Math.round(n)))
    .toString(16)
    .padStart(2, "0");
const hexOf = ({ r, g, b }: Rgb) => `#${part(r)}${part(g)}${part(b)}`;

function hslToRgb(h: number, s: number, l: number): Rgb {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: f(0) * 255, g: f(8) * 255, b: f(4) * 255 };
}

/** Saturation and lightness of a colour, 0..1, for telling a grey from a hue. */
export function saturationLightness({ r, g, b }: Rgb): { s: number; l: number } {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { s, l };
}

/** White, black, and the greys between: a page's paper and ink, not its brand. */
export function isNeutral(hex: string): boolean {
  const rgb = toRgb(hex);
  if (!rgb) return true;
  const { s, l } = saturationLightness(rgb);
  return s < 0.12 || l > 0.94 || l < 0.08;
}

/**
 * Every colour literal in a CSS value, as #rrggbb. Hex in any of its lengths,
 * rgb()/rgba() and hsl()/hsla() in either syntax; a colour painted mostly
 * transparent is left out, since it is not what the eye sees.
 */
export function colorsInValue(value: string): string[] {
  const out: string[] = [];
  const push = (hex: string | null) => {
    if (hex) out.push(hex);
  };

  for (const m of value.matchAll(/#([0-9a-f]{3,8})\b/gi)) {
    const h = m[1]!.toLowerCase();
    if (h.length === 3 || h.length === 4) {
      push(`#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`);
    } else if (h.length === 6) {
      push(`#${h}`);
    } else if (h.length === 8) {
      if (Number.parseInt(h.slice(6), 16) >= 128) push(`#${h.slice(0, 6)}`);
    }
  }

  for (const m of value.matchAll(/rgba?\(\s*([\d.]+)(%?)\s*[, ]\s*([\d.]+)(%?)\s*[, ]\s*([\d.]+)(%?)\s*(?:[,/]\s*([\d.]+)(%?)\s*)?\)/gi)) {
    const channel = (n: string, pct: string) => (pct ? (Number(n) / 100) * 255 : Number(n));
    const alpha = m[7] === undefined ? 1 : m[8] ? Number(m[7]) / 100 : Number(m[7]);
    if (alpha < 0.5) continue;
    push(hexOf({ r: channel(m[1]!, m[2]!), g: channel(m[3]!, m[4]!), b: channel(m[5]!, m[6]!) }));
  }

  for (const m of value.matchAll(/hsla?\(\s*([\d.]+)(?:deg)?\s*[, ]\s*([\d.]+)%\s*[, ]\s*([\d.]+)%\s*(?:[,/]\s*([\d.]+)(%?)\s*)?\)/gi)) {
    const alpha = m[4] === undefined ? 1 : m[5] ? Number(m[4]) / 100 : Number(m[4]);
    if (alpha < 0.5) continue;
    push(hexOf(hslToRgb(Number(m[1]), Number(m[2]) / 100, Number(m[3]) / 100)));
  }

  return out;
}

/**
 * How much a declaration says about the brand. A custom property named for
 * it says the most; a fill or a background says something; a shadow says
 * nothing.
 */
export function weightOf(property: string): number {
  const name = property.toLowerCase();
  if (name.startsWith("--")) {
    return /primary|brand|accent|theme|main/.test(name) ? 8 : 2;
  }
  if (/shadow|outline|filter/.test(name)) return 0;
  if (/^(background|background-color|color|fill|stroke|border|border-color|border-top|border-bottom|border-left|border-right|accent-color|caret-color)$/.test(name)) return 1;
  return 0;
}

/** Every colour in a stylesheet with the weight of where it was used. */
export function colorsInCss(css: string): Map<string, number> {
  const counts = new Map<string, number>();
  const text = css.slice(0, MAX_CSS_BYTES).replace(/\/\*[\s\S]*?\*\//g, " ");
  for (const m of text.matchAll(/([-a-zA-Z]+)\s*:\s*([^;{}]+)/g)) {
    const weight = weightOf(m[1]!);
    if (weight === 0) continue;
    for (const hex of colorsInValue(m[2]!)) {
      counts.set(hex, (counts.get(hex) ?? 0) + weight);
    }
  }
  return counts;
}

/** Two colours nobody could tell apart at a glance. */
function near(a: string, b: string): boolean {
  const x = toRgb(a);
  const y = toRgb(b);
  if (!x || !y) return false;
  return Math.abs(x.r - y.r) + Math.abs(x.g - y.g) + Math.abs(x.b - y.b) < 30;
}

/**
 * The site's palette, most used first: the hues it paints with, with white,
 * black and the greys left out — unless those are all it uses, in which case
 * they are the palette — and the browser's own link colours left out always.
 * Near-duplicates fold into the heavier one, so a hover shade does not count
 * twice.
 */
export function rankPalette(counts: Map<string, number>, limit = 6): string[] {
  const ranked = [...counts.entries()]
    .filter(([hex]) => !DEFAULT_LINK_COLORS.has(hex))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  const fold = (list: [string, number][]) => {
    const kept: string[] = [];
    for (const [hex] of list) {
      if (kept.some((seen) => near(seen, hex))) continue;
      kept.push(hex);
      if (kept.length >= limit) break;
    }
    return kept;
  };

  const hues = fold(ranked.filter(([hex]) => !isNeutral(hex)));
  if (hues.length > 0) return hues;
  return fold(ranked.filter(([hex]) => isNeutral(hex))).slice(0, 3);
}
