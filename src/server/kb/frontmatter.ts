import { parse } from "yaml";

/**
 * YAML frontmatter, the block between two `---` lines at the top of a Markdown
 * file. What it holds becomes the article's metadata; what follows it is the
 * article.
 */

export type Frontmatter = { data: Record<string, unknown>; body: string };

const RULE = /^---[ \t]*$/;
const CLOSING_RULE = /^(?:---|\.\.\.)[ \t]*$/;

export function parseFrontmatter(source: string): Frontmatter {
  const text = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  if (!RULE.test(lines[0] ?? "")) return { data: {}, body: text };

  const closing = lines.findIndex((line, index) => index > 0 && CLOSING_RULE.test(line));
  // An opening rule with nothing closing it is a horizontal rule, not metadata.
  if (closing === -1) return { data: {}, body: text };

  const body = lines.slice(closing + 1).join("\n").replace(/^\n+/, "");

  try {
    const data: unknown = parse(lines.slice(1, closing).join("\n"));
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      return { data: {}, body };
    }
    return { data: data as Record<string, unknown>, body };
  } catch {
    // Frontmatter that does not parse is kept out of the article rather than
    // failing it: the body is still worth having.
    return { data: {}, body };
  }
}

/** A frontmatter value as a trimmed string, or null when it is not one. */
export function asText(value: unknown): string | null {
  if (typeof value === "string") return value.trim() === "" ? null : value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/** YAML parses an unquoted date to a Date and a quoted one to a string. */
export function asDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number" && Number.isFinite(value)) {
    // Seconds or milliseconds since the epoch; nothing published predates 2001.
    const date = new Date(value < 1e11 ? value * 1000 : value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value !== "string" || value.trim() === "") return null;

  const text = value.trim();
  // A bare calendar date is midnight UTC, whatever the server's zone is.
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00Z` : text);
  return Number.isNaN(date.getTime()) ? null : date;
}
