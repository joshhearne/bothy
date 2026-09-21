import { normalizeHex, toRgb, type Rgb } from "@/lib/brand-color";

/**
 * What colour each kind of equipment is drawn in, and what is worth warning
 * about once the rack is full of them.
 *
 * Two colours that are numerically different can still be indistinguishable on
 * a printed elevation, so "too close" is measured perceptually in Oklab rather
 * than by comparing hex digits.
 */

export type Oklab = { L: number; a: number; b: number };

/** sRGB to Oklab, via linear light. Björn Ottosson's matrices. */
export function toOklab(rgb: Rgb): Oklab {
  const linear = (value: number) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };

  const r = linear(rgb.r);
  const g = linear(rgb.g);
  const b = linear(rgb.b);

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

/** Straight-line distance in Oklab, which is near enough to how different they look. */
export function colorDistance(first: string, second: string): number | null {
  const a = toRgb(first);
  const b = toRgb(second);
  if (!a || !b) return null;

  const one = toOklab(a);
  const two = toOklab(b);
  return Math.hypot(one.L - two.L, one.a - two.a, one.b - two.b);
}

/**
 * Below this, two blocks side by side on a printed page are a coin toss.
 * Oklab distance runs 0 to about 1, and a tenth of that is roughly where
 * "obviously different" stops.
 */
export const TOO_CLOSE = 0.12;

export function tooClose(first: string, second: string): boolean {
  const distance = colorDistance(first, second);
  return distance !== null && distance < TOO_CLOSE;
}

/**
 * The palette a new doc type is given when nobody has chosen for it. Spread
 * around the hue circle and checked against each other, so an MSP that never
 * touches this still gets a readable rack.
 */
export const DEFAULT_PALETTE = [
  "#2563eb", // blue
  "#16a34a", // green
  "#ea580c", // orange
  "#7c3aed", // violet
  "#0891b2", // cyan
  "#c026d3", // magenta
  "#4b5563", // slate
  "#be123c", // rose
  "#84cc16", // lime
  "#7c2d12", // brown
];

/** A stable colour for a type nobody has assigned one to. */
export function fallbackColor(docTypeId: string, index: number): string {
  if (index >= 0 && index < DEFAULT_PALETTE.length) {
    return DEFAULT_PALETTE[index] as string;
  }
  // Past the end of the palette, derive one from the id so it stays put.
  let hash = 0;
  for (const character of docTypeId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return DEFAULT_PALETTE[hash % DEFAULT_PALETTE.length] as string;
}

export type ColorSource = "company" | "global" | "fallback";

export type ResolvedColor = {
  docTypeId: string;
  docTypeName: string;
  color: string;
  source: ColorSource;
  /** What the MSP default is, when this client has overridden it. */
  globalColor: string | null;
};

export type ColorInput = {
  docTypeId: string;
  docTypeName: string;
  /** The MSP-wide default, if one is set. */
  global?: string | null;
  /** This client's override, if one is set. */
  company?: string | null;
};

/**
 * A client's choice wins, then the MSP default, then the palette. The MSP
 * default is kept alongside so the interface can say what was overridden.
 */
export function resolveColors(types: ColorInput[]): ResolvedColor[] {
  return types.map((type, index) => {
    const company = type.company ? normalizeHex(type.company) : null;
    const global = type.global ? normalizeHex(type.global) : null;

    const color = company ?? global ?? fallbackColor(type.docTypeId, index);
    const source: ColorSource = company ? "company" : global ? "global" : "fallback";

    return {
      docTypeId: type.docTypeId,
      docTypeName: type.docTypeName,
      color,
      source,
      globalColor: global,
    };
  });
}

export type ColorWarning =
  | {
      kind: "too_close";
      /** The two types whose colours a reader would struggle to tell apart. */
      types: [string, string];
      distance: number;
    }
  | {
      kind: "override_shadows_global";
      /** A client override that has landed on a colour already in use here. */
      type: string;
      collidesWith: string;
    };

/**
 * What is worth saying about a set of colours once they are all on one page.
 *
 * Two things: colours a reader cannot tell apart, and a client override that
 * has taken on a colour another type is already using here — the second is
 * worth its own warning because the fix is to change the override, and nobody
 * would think to look for it otherwise.
 */
export function colorWarnings(resolved: ResolvedColor[]): ColorWarning[] {
  const warnings: ColorWarning[] = [];

  for (let i = 0; i < resolved.length; i += 1) {
    for (let j = i + 1; j < resolved.length; j += 1) {
      const one = resolved[i] as ResolvedColor;
      const two = resolved[j] as ResolvedColor;

      const distance = colorDistance(one.color, two.color);
      if (distance === null || distance >= TOO_CLOSE) continue;

      warnings.push({
        kind: "too_close",
        types: [one.docTypeName, two.docTypeName],
        distance: Number(distance.toFixed(3)),
      });

      // When one of the two is an override, the fix is to move the override.
      const overridden = one.source === "company" ? one : two.source === "company" ? two : null;
      if (overridden) {
        const other = overridden === one ? two : one;
        warnings.push({
          kind: "override_shadows_global",
          type: overridden.docTypeName,
          collidesWith: other.docTypeName,
        });
      }
    }
  }
  return warnings;
}
