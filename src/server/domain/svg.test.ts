import { describe, expect, it } from "vitest";
import { looksLikeSvg, svgToPng } from "./svg";

const SVG = Buffer.from(
  `<?xml version="1.0"?>\n<!-- mark -->\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#0a7f5a"/></svg>`,
);

describe("looksLikeSvg", () => {
  it("accepts an svg root past a prolog and comments, and refuses other things", () => {
    expect(looksLikeSvg(SVG)).toBe(true);
    expect(looksLikeSvg(Buffer.from("<html><svg></svg></html>"))).toBe(false);
    expect(looksLikeSvg(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
  });
});

describe("svgToPng", () => {
  it("renders to a PNG that keeps transparency", async () => {
    const png = await svgToPng(SVG);
    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    const sharp = (await import("sharp")).default;
    const meta = await sharp(png).metadata();
    expect(meta.hasAlpha).toBe(true);
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(512);
    // The corner outside the circle is transparent.
    const { data } = await sharp(png)
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(data[3]).toBe(0);
  });

  it("refuses what is not an SVG", async () => {
    await expect(svgToPng(Buffer.from("not svg"))).rejects.toThrow(
      /not an SVG/,
    );
  });
});
