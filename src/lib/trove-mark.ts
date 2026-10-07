/**
 * The product's own mark: a cut gem, for a trove. It stands in wherever an
 * operator has not put a logo of their own, and it is what the tab icon is
 * made of. The geometry lives here, away from React, so the same shapes feed
 * the inline mark, the SVG favicon, and the PNG the touch icon needs.
 */

/** The accent the palette ships with, as hex so a favicon can carry it. */
export const DEFAULT_ACCENT_LIGHT = "#0f766e";
export const DEFAULT_ACCENT_DARK = "#2dd4bf";

/** The surfaces, for the browser chrome that asks for a colour. */
export const SURFACE_LIGHT = "#ffffff";
export const SURFACE_DARK = "#1e2129";

/**
 * Each facet of the gem on a 32×32 grid, with how much of the colour it
 * carries: the pavilion is solid, the crown lets light through. Drawn in one
 * colour, which is what makes it a mark rather than an illustration.
 */
export const FACETS: { d: string; opacity: number }[] = [
  { d: "M10 4 L3 12 L11 12 Z", opacity: 0.72 },
  { d: "M10 4 L22 4 L21 12 L11 12 Z", opacity: 0.5 },
  { d: "M22 4 L29 12 L21 12 Z", opacity: 0.72 },
  { d: "M3 12 L11 12 L16 29 Z", opacity: 0.84 },
  { d: "M11 12 L21 12 L16 29 Z", opacity: 1 },
  { d: "M21 12 L29 12 L16 29 Z", opacity: 0.84 },
];

/** The facet paths in SVG, in the colour the parent sets. */
function facets(): string {
  return FACETS.map((facet) => `<path d="${facet.d}" fill-opacity="${facet.opacity}"/>`).join("");
}

/**
 * The icon as an SVG document: a rounded tile in the accent with the gem in
 * white on it, which is what a favicon or home-screen icon wants. The colour
 * is a hex the caller has already normalized; nothing else is interpolated.
 */
export function iconSvg(accent: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">` +
    `<rect width="32" height="32" rx="7" fill="${accent}"/>` +
    `<g transform="translate(4 4) scale(0.75)" fill="#ffffff">${facets()}</g>` +
    `</svg>`
  );
}
