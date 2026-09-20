import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import {
  acceptUpload,
  ACCEPTED_UPLOAD_TYPES,
  ConversionFailedError,
  MacroEnabledError,
  UnsupportedFileError,
} from "./accept";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const GIF = Buffer.from("GIF89a--------", "ascii");
const WEBP = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.from([0x24, 0, 0, 0]),
  Buffer.from("WEBPVP8 ", "ascii"),
]);
const PDF = Buffer.from("%PDF-1.7\n%âãÏÓ\n", "latin1");
const OLE2 = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);

/** An ISO base media header with the given brand, as HEIC and AVIF carry. */
function iso(brand: string): Buffer {
  return Buffer.concat([
    Buffer.from([0, 0, 0, 0x18]),
    Buffer.from("ftyp", "ascii"),
    Buffer.from(brand.padEnd(4, " "), "ascii"),
    Buffer.alloc(8),
  ]);
}

/** A real zip, built here, so the Office checks run against the real parser. */
function office(entries: Record<string, string>): Buffer {
  const files: Record<string, Uint8Array> = {};
  for (const [name, body] of Object.entries(entries)) files[name] = strToU8(body);
  return Buffer.from(zipSync(files));
}

describe("images", () => {
  it("takes the formats a browser draws", async () => {
    for (const [bytes, mime] of [
      [PNG, "image/png"],
      [JPEG, "image/jpeg"],
      [GIF, "image/gif"],
      [WEBP, "image/webp"],
      [iso("avif"), "image/avif"],
    ] as const) {
      const accepted = await acceptUpload("photo.bin", bytes as Buffer);
      expect(accepted.mime).toBe(mime);
      expect(accepted.category).toBe("image");
      // Nothing is rewritten unless it had to be.
      expect(accepted.bytes).toBe(bytes);
    }
  });

  it("goes by the bytes, not the name", async () => {
    const accepted = await acceptUpload("invoice.pdf", PNG);
    expect(accepted.mime).toBe("image/png");
    expect(accepted.extension).toBe("png");
  });
});

describe("documents", () => {
  it("takes a PDF", async () => {
    const accepted = await acceptUpload("contract.pdf", PDF);
    expect(accepted.mime).toBe("application/pdf");
    expect(accepted.category).toBe("document");
  });

  it("takes Word, Excel, and PowerPoint", async () => {
    const cases = [
      ["word/document.xml", "wordprocessingml.document", "docx"],
      ["xl/workbook.xml", "spreadsheetml.sheet", "xlsx"],
      ["ppt/presentation.xml", "presentationml.presentation", "pptx"],
    ] as const;

    for (const [marker, mime, extension] of cases) {
      const accepted = await acceptUpload("file.bin", office({ [marker]: "<xml/>" }));
      expect(accepted.mime).toContain(mime);
      expect(accepted.extension).toBe(extension);
    }
  });

  it("refuses a macro-enabled document whatever it is called", async () => {
    const macro = office({ "word/document.xml": "<xml/>", "word/vbaProject.bin": "\0\0" });
    await expect(acceptUpload("harmless.docx", macro)).rejects.toThrow(MacroEnabledError);
  });

  it("refuses legacy Office, which carries macros of its own", async () => {
    await expect(acceptUpload("old.doc", OLE2)).rejects.toThrow(MacroEnabledError);
  });

  it("refuses a zip that is not an Office document", async () => {
    await expect(acceptUpload("stuff.zip", office({ "readme.txt": "hi" }))).rejects.toThrow(
      UnsupportedFileError,
    );
  });

  it("takes text by its extension once the bytes agree", async () => {
    for (const [name, mime] of [
      ["notes.txt", "text/plain"],
      ["runbook.md", "text/markdown"],
      ["export.csv", "text/csv"],
    ] as const) {
      const accepted = await acceptUpload(name, Buffer.from("hello, world\n"));
      expect(accepted.mime).toBe(mime);
    }
  });

  it("refuses binary wearing a text extension", async () => {
    await expect(acceptUpload("notes.txt", Buffer.from([0x00, 0x01, 0x02]))).rejects.toThrow(
      UnsupportedFileError,
    );
    await expect(acceptUpload("notes.txt", Buffer.from([0xff, 0xfe, 0xfd]))).rejects.toThrow(
      UnsupportedFileError,
    );
  });
});

describe("HEIC and HEIF", () => {
  const JPEG_OUT = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43]);
  const fakeConverter = async () => JPEG_OUT;

  it("is converted to JPEG on the way in, not stored as it arrived", async () => {
    for (const brand of ["heic", "heix", "mif1", "msf1", "hevc"]) {
      const original = iso(brand);
      const accepted = await acceptUpload("IMG_4021.HEIC", original, fakeConverter);

      expect(accepted.mime).toBe("image/jpeg");
      expect(accepted.extension).toBe("jpg");
      expect(accepted.category).toBe("image");
      expect(accepted.bytes).toBe(JPEG_OUT);
      expect(accepted.bytes).not.toBe(original);
      expect(accepted.convertedFrom).toBeTruthy();
    }
  });

  it("says so plainly when the file is not really HEIC", async () => {
    const broken = async () => {
      throw new ConversionFailedError();
    };
    await expect(acceptUpload("IMG_1.HEIC", iso("heic"), broken)).rejects.toThrow(
      ConversionFailedError,
    );
  });

  it("leaves AVIF alone, which browsers draw as it is", async () => {
    const accepted = await acceptUpload("photo.avif", iso("avif"), fakeConverter);
    expect(accepted.mime).toBe("image/avif");
    expect(accepted.convertedFrom).toBeUndefined();
  });
});

describe("everything else", () => {
  it("is refused", async () => {
    for (const [name, bytes] of [
      ["run.exe", Buffer.from("MZ\x90\x00")],
      ["script.sh", Buffer.from("#!/bin/sh\nrm -rf /\n")],
      ["empty.txt", Buffer.alloc(0)],
      ["page.html", Buffer.from("<!doctype html><script>alert(1)</script>")],
    ] as const) {
      await expect(acceptUpload(name, bytes as Buffer)).rejects.toThrow(UnsupportedFileError);
    }
  });
});

describe("ACCEPTED_UPLOAD_TYPES", () => {
  it("offers what the policy takes, and nothing it does not", () => {
    for (const mime of ["image/png", "application/pdf", "text/csv", "image/heic"]) {
      expect(ACCEPTED_UPLOAD_TYPES).toContain(mime);
    }
    expect(ACCEPTED_UPLOAD_TYPES).not.toContain("image/svg");
    expect(ACCEPTED_UPLOAD_TYPES).not.toContain("application/zip");
  });
});
