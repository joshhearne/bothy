import { describe, expect, it } from "vitest";
import { brandingInputSchema, sniffImage, LOGO_ACCEPT } from "./branding";

/** A one-pixel file of each kind, just the header bytes the sniffer reads. */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const WEBP = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from("WEBPVP8 ", "ascii"),
]);

describe("sniffImage", () => {
  it("recognizes the formats it offers", () => {
    expect(sniffImage(PNG)?.mime).toBe("image/png");
    expect(sniffImage(JPEG)?.mime).toBe("image/jpeg");
    expect(sniffImage(WEBP)?.mime).toBe("image/webp");
    for (const mime of ["image/png", "image/jpeg", "image/webp"]) {
      expect(LOGO_ACCEPT).toContain(mime);
    }
  });

  it("refuses an SVG, whatever it calls itself", () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(sniffImage(svg)).toBeNull();
    expect(LOGO_ACCEPT).not.toContain("svg");
  });

  it("refuses a script wearing a PNG extension", () => {
    expect(sniffImage(Buffer.from("<!doctype html><script>alert(1)</script>"))).toBeNull();
    expect(sniffImage(Buffer.from("GIF89a"))).toBeNull();
    expect(sniffImage(Buffer.alloc(0))).toBeNull();
  });
});

describe("brandingInputSchema", () => {
  it("keeps a name and a normalized color", () => {
    expect(brandingInputSchema.parse({ name: "  HearneTech Docs ", accent: "#1F6FEB" })).toEqual({
      name: "HearneTech Docs",
      accent: "#1f6feb",
    });
  });

  it("treats an empty color as no color rather than an error", () => {
    expect(brandingInputSchema.parse({ name: null, accent: "" }).accent).toBeNull();
    expect(brandingInputSchema.parse({ name: null, accent: null }).accent).toBeNull();
  });

  it("drops anything that is not a hex color, so nothing else reaches a stylesheet", () => {
    for (const accent of ["red", "url(javascript:alert(1))", "#fff; background: url(x)", "}"]) {
      expect(brandingInputSchema.parse({ name: null, accent }).accent).toBeNull();
    }
  });

  it("caps the name", () => {
    expect(brandingInputSchema.safeParse({ name: "x".repeat(61), accent: null }).success).toBe(false);
  });
});
