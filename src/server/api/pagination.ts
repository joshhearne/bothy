/**
 * Cursor pagination, as docs/API.md specifies: `?limit=50&cursor=...` in,
 * `next_cursor` out. Cursors are opaque base64url of the last row's sort key.
 */

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

export function parseLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

export function encodeCursor(value: { sort: string; id: string }): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function decodeCursor(raw: string | null): { sort: string; id: string } | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      typeof (parsed as { sort?: unknown }).sort === "string" &&
      typeof (parsed as { id?: unknown }).id === "string"
    ) {
      return parsed as { sort: string; id: string };
    }
    return null;
  } catch {
    // A malformed cursor reads as "start from the beginning", never a crash.
    return null;
  }
}

/** Splits an over-fetched page into the page itself plus the next cursor. */
export function toPage<T extends { id: string }>(
  rows: T[],
  limit: number,
  sortOf: (row: T) => string,
): { data: T[]; next_cursor: string | null } {
  const data = rows.slice(0, limit);
  const last = data.at(-1);
  return {
    data,
    next_cursor:
      rows.length > limit && last ? encodeCursor({ sort: sortOf(last), id: last.id }) : null,
  };
}
