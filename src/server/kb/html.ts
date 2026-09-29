import "server-only";
import sanitizeHtml from "sanitize-html";
import TurndownService from "turndown";

/**
 * HTML to Markdown, for Word documents and crawled pages. The HTML is cut
 * down to what an article is made of first, so navigation, scripts, and
 * styling never reach the converter.
 */

const ARTICLE_TAGS = [
  "p", "br", "hr",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "strong", "b", "em", "i", "code", "pre", "blockquote",
  "ul", "ol", "li", "a",
  "table", "thead", "tbody", "tr", "th", "td",
];

let converter: TurndownService | undefined;

function turndown(): TurndownService {
  converter ??= new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });
  return converter;
}

export function htmlToMarkdown(html: string): string {
  const clean = sanitizeHtml(html, {
    allowedTags: ARTICLE_TAGS,
    allowedAttributes: { a: ["href"] },
    allowedSchemes: ["http", "https", "mailto"],
    // Dropped with everything inside them, not unwrapped into the text.
    nonTextTags: ["script", "style", "textarea", "option", "noscript", "nav", "header", "footer", "aside", "form", "svg"],
  });

  return turndown()
    .turndown(clean)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The part of a page that is the article, when the page says which it is. */
export function mainContent(html: string): string {
  for (const tag of ["article", "main"]) {
    const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*)</${tag}>`, "i").exec(html);
    if (match?.[1] && match[1].replace(/<[^>]+>/g, "").trim().length > 200) return match[1];
  }
  const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html);
  return body?.[1] ?? html;
}

function decode(text: string): string {
  return sanitizeHtml(text, { allowedTags: [], allowedAttributes: {} })
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function pageTitle(html: string): string | null {
  const heading = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return decode(heading?.[1] ?? "") || decode(title?.[1] ?? "") || null;
}

/** Every link on a page, resolved against it, without fragments. */
export function pageLinks(html: string, base: string): string[] {
  const links = new Set<string>();
  for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const href = (match[1] ?? match[2] ?? "").replace(/&amp;/g, "&").trim();
    if (href === "" || href.startsWith("#")) continue;
    try {
      const url = new URL(href, base);
      if (url.protocol !== "https:" && url.protocol !== "http:") continue;
      url.hash = "";
      links.add(url.toString());
    } catch {
      // Not a link worth following.
    }
  }
  return [...links];
}
