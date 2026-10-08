import "server-only";
import { isWorkers } from "@/lib/runtime";

/**
 * An SVG icon rendered to PNG, transparency kept. Many sites offer their mark
 * only as SVG, and a logo here must be a raster: an SVG is a document that can
 * carry script, and a logo is drawn on every page. Rendering it once, here,
 * keeps the look and drops the document.
 */

export class SvgUnavailableError extends Error {
  constructor() {
    super("SVG icons cannot be converted in this deployment");
    this.name = "SvgUnavailableError";
  }
}

export class SvgInvalidError extends Error {
  constructor() {
    super("The icon is not an SVG that can be drawn");
    this.name = "SvgInvalidError";
  }
}

/** The longer side of the PNG. Large enough for any header, small enough to keep. */
export const SVG_RASTER_SIZE = 512;

/** Whether the bytes are an SVG document: an <svg> root, after any prolog. */
export function looksLikeSvg(bytes: Buffer): boolean {
  const head = bytes
    .subarray(0, 4096)
    .toString("utf8")
    .replace(/^\uFEFF/, "")
    .trimStart();
  if (head.includes("\0")) return false;
  // Past an XML declaration, a doctype, and comments, the root must be <svg.
  const stripped = head
    .replace(/^<\?xml[^>]*\?>\s*/i, "")
    .replace(/^(?:<!--[\s\S]*?-->\s*)*/, "")
    .replace(/^<!DOCTYPE[^>]*>\s*/i, "")
    .replace(/^(?:<!--[\s\S]*?-->\s*)*/, "");
  return /^<svg[\s>]/i.test(stripped);
}

export async function svgToPng(bytes: Buffer): Promise<Buffer> {
  if (isWorkers()) throw new SvgUnavailableError();
  if (!looksLikeSvg(bytes)) throw new SvgInvalidError();

  // Native, so resolved at runtime and never bundled, as heic-convert is.
  const specifier = "sharp";
  type Sharp = (typeof import("sharp"))["default"];
  let sharp: Sharp;
  try {
    sharp = (
      (await import(/* webpackIgnore: true */ specifier)) as { default: Sharp }
    ).default;
  } catch {
    throw new SvgUnavailableError();
  }

  try {
    return await sharp(bytes, { density: 144 })
      .resize(SVG_RASTER_SIZE, SVG_RASTER_SIZE, {
        fit: "inside",
        withoutEnlargement: false,
      })
      .png()
      .toBuffer();
  } catch {
    throw new SvgInvalidError();
  }
}
