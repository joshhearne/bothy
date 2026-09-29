import { asDate, asText } from "@/server/kb/frontmatter";

/**
 * manifest.json, when an export carries one: what the source says changed and
 * when. It lets a re-import leave an unchanged article alone without opening
 * its file.
 *
 * Exports do not agree on a shape, so this reads the ones seen in the wild: a
 * list, a list under `articles` / `items` / `files` / `documents`, or an object
 * keyed by id or path.
 */

export type ManifestEntry = { dateModified: Date };

export type Manifest = {
  byId: Map<string, ManifestEntry>;
  byPath: Map<string, ManifestEntry>;
  size: number;
};

const LIST_KEYS = ["articles", "items", "files", "documents", "entries"];
const ID_KEYS = ["article_id", "external_id", "id"];
const PATH_KEYS = ["path", "file", "file_path", "filename", "filepath"];
const DATE_KEYS = ["date_modified", "modified", "updated_at", "last_modified", "lastmod"];

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.?\/+/, "");
}

function first(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseManifest(json: string): Manifest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  const manifest: Manifest = { byId: new Map(), byPath: new Map(), size: 0 };

  const add = (entry: unknown, key?: string) => {
    if (!isRecord(entry)) return;
    const dateModified = asDate(first(entry, DATE_KEYS));
    if (!dateModified) return;

    const id = asText(first(entry, ID_KEYS));
    const path = asText(first(entry, PATH_KEYS));
    if (id) manifest.byId.set(id, { dateModified });
    if (path) manifest.byPath.set(normalizePath(path), { dateModified });

    // An object keyed by id or path names the entry with its key.
    if (!id && !path && key) {
      if (/[\\/]|\.\w{2,5}$/.test(key)) manifest.byPath.set(normalizePath(key), { dateModified });
      else manifest.byId.set(key, { dateModified });
    } else if (!id && !path) return;

    manifest.size += 1;
  };

  let list: unknown = parsed;
  if (isRecord(parsed)) {
    const named = LIST_KEYS.map((key) => parsed[key]).find((value) => value !== undefined);
    list = named ?? parsed;
  }

  if (Array.isArray(list)) for (const entry of list) add(entry);
  else if (isRecord(list)) for (const [key, entry] of Object.entries(list)) add(entry, key);

  return manifest.size > 0 ? manifest : null;
}

/** Whether the source's date matches what is stored, to the second. */
export function sameInstant(a: Date | null, b: Date | null): boolean {
  if (!a || !b) return false;
  return Math.floor(a.getTime() / 1000) === Math.floor(b.getTime() / 1000);
}
