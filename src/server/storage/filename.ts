/**
 * Filenames are shown and offered for download, so they are normalized before
 * storage: no path segments, no control characters, bounded length.
 */
export function sanitizeFilename(input: string, fallback = "attachment"): string {
  const base = input.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/^\.+/, "")
    .trim();

  if (cleaned === "") return fallback;
  return cleaned.length > 180 ? cleaned.slice(0, 180) : cleaned;
}

/** RFC 6266 value for Content-Disposition, safe for non-ASCII names. */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
