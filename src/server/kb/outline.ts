/**
 * An article's outline, read from its own headings after it is drawn. The
 * headings get ids of ours, so the outline links to them; a source site's
 * own anchors and menus are dropped on import and never reach here.
 */

import { textOf } from "./entities";

export type OutlineItem = { id: string; level: number; text: string };

const HEADING = /<h([1-4])\b([^>]*)>([\s\S]*?)<\/h\1>/gi;

/**
 * The HTML with an id on every heading, and the outline those headings make.
 * Sanitized HTML goes in; only ids of the form `section-N` are added, so
 * nothing from the article can name an anchor.
 */
export function outlineHtml(html: string): { html: string; outline: OutlineItem[] } {
  const outline: OutlineItem[] = [];
  const marked = html.replace(HEADING, (whole, level: string, attributes: string, inner: string) => {
    const text = textOf(inner);
    if (text === "") return whole;
    const id = `section-${outline.length + 1}`;
    outline.push({ id, level: Number(level), text });
    const rest = attributes.replace(/\s+id\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
    return `<h${level} id="${id}"${rest}>${inner}</h${level}>`;
  });

  // One heading alone is a title, not an outline.
  if (outline.length < 2) return { html, outline: [] };

  // Depth is relative: the shallowest heading in the article is the top level.
  const top = Math.min(...outline.map((item) => item.level));
  return { html: marked, outline: outline.map((item) => ({ ...item, level: item.level - top + 1 })) };
}
