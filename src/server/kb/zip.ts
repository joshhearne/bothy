import "server-only";
import { createReadStream } from "node:fs";
import { Unzip, UnzipInflate, type UnzipFile } from "fflate";
import { normalizePath } from "@/server/kb/manifest";

/**
 * Reads an archive from disk a piece at a time, handing over one file at a
 * time. Nothing is written back out, so a hostile entry name has nowhere to
 * land, and the whole archive is never in memory at once.
 */

/** No single article is this large; an entry that is, is not an article. */
export const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
/** What an archive may unpack to in total, against one built to exhaust a disk. */
export const MAX_TOTAL_BYTES = 4 * 1024 * 1024 * 1024;
export const MAX_ENTRIES = 200_000;

export class ArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchiveError";
  }
}

export type ArchiveEntry = { path: string; bytes: Buffer | null; tooLarge: boolean };

/** Entries that are part of the packaging, not of what was packaged. */
function isNoise(path: string): boolean {
  return (
    path.endsWith("/") ||
    path.startsWith("__MACOSX/") ||
    path.split("/").some((part) => part === ".DS_Store" || part === "Thumbs.db")
  );
}

/**
 * Calls `want` for every entry and `onEntry` for each one it asked for, in
 * archive order, waiting for each call before reading further.
 */
export async function readArchive(
  file: string,
  want: (path: string) => boolean,
  onEntry: (entry: ArchiveEntry) => Promise<void>,
): Promise<string[]> {
  const names: string[] = [];
  const ready: ArchiveEntry[] = [];
  let total = 0;
  let failure: Error | null = null;

  const unzip = new Unzip();
  unzip.register(UnzipInflate);

  unzip.onfile = (entry: UnzipFile) => {
    const path = normalizePath(entry.name);
    if (isNoise(path)) return;

    names.push(path);
    if (names.length > MAX_ENTRIES) {
      failure = new ArchiveError("The archive holds more files than an import accepts");
      return;
    }
    if (!want(path)) return;

    if ((entry.originalSize ?? 0) > MAX_ENTRY_BYTES) {
      ready.push({ path, bytes: null, tooLarge: true });
      return;
    }

    const parts: Uint8Array[] = [];
    let size = 0;
    let abandoned = false;

    entry.ondata = (error, data, final) => {
      if (abandoned) return;
      if (error) {
        abandoned = true;
        ready.push({ path, bytes: null, tooLarge: false });
        return;
      }

      size += data.length;
      total += data.length;
      if (total > MAX_TOTAL_BYTES) {
        failure = new ArchiveError("The archive unpacks to more than an import accepts");
        abandoned = true;
        return;
      }
      if (size > MAX_ENTRY_BYTES) {
        abandoned = true;
        entry.terminate();
        ready.push({ path, bytes: null, tooLarge: true });
        return;
      }

      parts.push(data);
      if (final) ready.push({ path, bytes: Buffer.concat(parts), tooLarge: false });
    };
    entry.start();
  };

  const stream = createReadStream(file, { highWaterMark: 1024 * 1024 });
  try {
    for await (const piece of stream) {
      try {
        unzip.push(piece as Buffer, false);
      } catch {
        throw new ArchiveError("That file is not a zip archive, or it is damaged");
      }
      if (failure) throw failure;

      while (ready.length > 0) await onEntry(ready.shift() as ArchiveEntry);
    }
    unzip.push(new Uint8Array(0), true);
    while (ready.length > 0) await onEntry(ready.shift() as ArchiveEntry);
  } finally {
    stream.destroy();
  }

  if (names.length === 0) throw new ArchiveError("The archive is empty");
  return names;
}

/**
 * The folder every entry sits under, when there is one: zipping a folder
 * usually wraps its contents in the folder's own name.
 */
export function commonRoot(paths: string[]): string {
  const first = paths[0]?.split("/")[0];
  if (!first || paths.some((path) => !path.startsWith(`${first}/`))) return "";
  return `${first}/`;
}
