import "server-only";
import { unzipSync } from "fflate";
import { isWorkers } from "@/lib/runtime";

/**
 * What a document may carry as an attachment, decided from the file's own
 * bytes. The browser's declared type is a hint and is never consulted: a
 * renamed executable claims whatever its uploader likes.
 *
 * Images are the formats a browser draws. Documents are PDF, the macro-free
 * Office formats, and plain text. HEIC and HEIF are accepted and converted to
 * JPEG on the way in, because they arrive from phones and almost nothing else
 * renders them.
 */

export type UploadCategory = "image" | "document";

export type AcceptedUpload = {
  mime: string;
  extension: string;
  category: UploadCategory;
  /** What to store. Identical to the input unless the file was converted. */
  bytes: Buffer;
  /** Set when the stored bytes are no longer what was uploaded. */
  convertedFrom?: string;
};

export class UnsupportedFileError extends Error {
  constructor() {
    super(
      "That file type is not accepted. Images, PDF, Word, Excel, PowerPoint, CSV, " +
        "Markdown, and plain text are.",
    );
    this.name = "UnsupportedFileError";
  }
}

export class MacroEnabledError extends Error {
  constructor() {
    super("That file contains macros, which are not accepted. Save it without macros and try again.");
    this.name = "MacroEnabledError";
  }
}

export class ConversionUnavailableError extends Error {
  constructor() {
    super("HEIC images cannot be converted in this deployment. Upload a JPEG or PNG instead.");
    this.name = "ConversionUnavailableError";
  }
}

export class ConversionFailedError extends Error {
  constructor() {
    super("That HEIC image could not be read. Try exporting it as a JPEG.");
    this.name = "ConversionFailedError";
  }
}

/** Images a browser can draw as they are. */
const IMAGE_SIGNATURES: { mime: string; extension: string; matches: (b: Buffer) => boolean }[] = [
  {
    mime: "image/png",
    extension: "png",
    matches: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  { mime: "image/jpeg", extension: "jpg", matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/gif", extension: "gif", matches: (b) => b.subarray(0, 6).toString("ascii").startsWith("GIF8") },
  {
    mime: "image/webp",
    extension: "webp",
    matches: (b) => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP",
  },
  { mime: "image/avif", extension: "avif", matches: (b) => isoBrand(b) === "avif" },
];

/** The ISO base media brand, which is how HEIC and AVIF identify themselves. */
function isoBrand(bytes: Buffer): string | null {
  if (bytes.length < 12) return null;
  if (bytes.subarray(4, 8).toString("ascii") !== "ftyp") return null;
  return bytes.subarray(8, 12).toString("ascii").trim().toLowerCase();
}

const HEIF_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1"]);

/** Text formats have no signature, so the name decides and the bytes confirm. */
const TEXT_TYPES: Record<string, { mime: string; extension: string }> = {
  txt: { mime: "text/plain", extension: "txt" },
  text: { mime: "text/plain", extension: "txt" },
  log: { mime: "text/plain", extension: "txt" },
  md: { mime: "text/markdown", extension: "md" },
  markdown: { mime: "text/markdown", extension: "md" },
  csv: { mime: "text/csv", extension: "csv" },
};

/** What the file input offers, and what the hint under it lists. */
export const ACCEPTED_UPLOAD_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/heic",
  "image/heif",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/markdown",
  "text/csv",
  ".md",
  ".markdown",
  ".csv",
  ".txt",
  ".heic",
  ".heif",
].join(",");

const OOXML = {
  "word/document.xml": {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extension: "docx",
  },
  "xl/workbook.xml": {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    extension: "xlsx",
  },
  "ppt/presentation.xml": {
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    extension: "pptx",
  },
} as const;

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
}

/**
 * An Office file is a zip. Which kind it is, and whether it carries macros, is
 * in its entry names — `vbaProject.bin` is what a macro-enabled document adds,
 * whatever extension it was saved under.
 */
function readOoxml(bytes: Buffer): { mime: string; extension: string } {
  const names: string[] = [];
  try {
    // The filter sees every entry and keeps none, so the central directory is
    // read but nothing is decompressed: a large workbook costs almost nothing.
    unzipSync(bytes, {
      filter: (entry) => {
        names.push(entry.name);
        return false;
      },
    });
  } catch {
    throw new UnsupportedFileError();
  }

  if (names.some((name) => name.toLowerCase().endsWith("vbaproject.bin"))) {
    throw new MacroEnabledError();
  }

  for (const [marker, kind] of Object.entries(OOXML)) {
    if (names.includes(marker)) return kind;
  }
  // A zip that is not an Office document is just a zip.
  throw new UnsupportedFileError();
}

function isProbablyText(bytes: Buffer): boolean {
  if (bytes.includes(0)) return false;
  // Round-tripping catches invalid UTF-8, which a binary file will fail.
  return Buffer.from(bytes.toString("utf8"), "utf8").equals(bytes);
}

/** Swapped out in tests: the real one is a large WebAssembly decoder. */
export type HeicConverter = (bytes: Buffer) => Promise<Buffer>;

async function heicToJpeg(bytes: Buffer): Promise<Buffer> {
  // The decoder is WebAssembly, which a Worker is not allowed to compile.
  if (isWorkers()) throw new ConversionUnavailableError();

  /*
   * Resolved at runtime rather than bundled. The decoder is 8 MB of
   * WebAssembly that only the Node deployment can run, and inlining it would
   * push the Worker past its size limit to carry code it may never execute.
   */
  const specifier = "heic-convert";
  let convert: typeof import("heic-convert");
  try {
    convert = ((await import(/* webpackIgnore: true */ specifier)) as {
      default: typeof import("heic-convert");
    }).default;
  } catch {
    throw new ConversionUnavailableError();
  }

  try {
    const jpeg = await convert({ buffer: new Uint8Array(bytes), format: "JPEG", quality: 0.85 });
    return Buffer.from(jpeg);
  } catch {
    // The file said it was HEIC and was not, or is damaged.
    throw new ConversionFailedError();
  }
}

/**
 * Decides whether a file may be stored and returns the bytes to store. Throws
 * one of the errors above, each of which says what to do about it.
 */
export async function acceptUpload(
  filename: string,
  bytes: Buffer,
  convertHeic: HeicConverter = heicToJpeg,
): Promise<AcceptedUpload> {
  if (bytes.byteLength === 0) throw new UnsupportedFileError();

  for (const signature of IMAGE_SIGNATURES) {
    if (signature.matches(bytes)) {
      return { mime: signature.mime, extension: signature.extension, category: "image", bytes };
    }
  }

  const brand = isoBrand(bytes);
  if (brand && HEIF_BRANDS.has(brand)) {
    return {
      mime: "image/jpeg",
      extension: "jpg",
      category: "image",
      bytes: await convertHeic(bytes),
      convertedFrom: brand === "mif1" || brand === "msf1" ? "heif" : "heic",
    };
  }

  if (bytes.subarray(0, 5).toString("ascii") === "%PDF-") {
    return { mime: "application/pdf", extension: "pdf", category: "document", bytes };
  }

  // Legacy Office is an OLE2 compound file, which carries macros of its own.
  if (bytes.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) {
    throw new MacroEnabledError();
  }

  if (bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    const kind = readOoxml(bytes);
    return { ...kind, category: "document", bytes };
  }

  const text = TEXT_TYPES[extensionOf(filename)];
  if (text && isProbablyText(bytes)) {
    return { ...text, category: "document", bytes };
  }

  throw new UnsupportedFileError();
}
