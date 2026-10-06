import "server-only";
import sanitizeHtml from "sanitize-html";
import TurndownService from "turndown";
import { textOf } from "./entities";

/**
 * HTML to Markdown, for Word documents and crawled pages. The HTML is cut
 * down to what an article is made of first, so navigation, scripts, and
 * styling never reach the converter.
 */

const ARTICLE_TAGS = [
  "p", "br", "hr",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "strong", "b", "em", "i", "code", "pre", "blockquote",
  "ul", "ol", "li", "a", "img",
  "table", "thead", "tbody", "tr", "th", "td",
];

let converter: TurndownService | undefined;

function turndown(): TurndownService {
  if (converter) return converter;
  converter = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });

  // A list item that only wraps another list, drawn without a marker, is
  // not a step: its items are the steps, at this depth.
  converter.addRule("wrappingItem", {
    filter: (node) => {
      if (node.nodeName !== "LI") return false;
      const children = [...node.childNodes].filter(
        (child) => child.nodeType !== 3 || (child.textContent ?? "").trim() !== "",
      );
      return children.length === 1 && /^(UL|OL)$/.test(children[0]?.nodeName ?? "");
    },
    replacement: (content) => content.replace(/^\n+/, "").replace(/\n+$/, "\n"),
  });

  // A link with nothing to click: no words and no picture. And a picture
  // that links to nowhere on the page: a print or share button.
  converter.addRule("emptyLink", {
    filter: (node) => {
      if (node.nodeName !== "A") return false;
      const element = node as unknown as Element;
      if ((node.textContent ?? "").trim() !== "") return false;
      const href = element.getAttribute?.("href") ?? "";
      return !element.querySelector?.("img") || /^#?$/.test(href.trim());
    },
    replacement: () => "",
  });

  return converter;
}

/** Lists that are the page's furniture, not its content: breadcrumbs, and menus of links to anchors on the same page. */
function dropPageLists(html: string): string {
  const innermost = /<(ul|ol)\b([^>]*)>((?:(?!<(?:ul|ol)\b)[\s\S])*?)<\/\1>/gi;
  let previous = "";
  let current = html;
  while (current !== previous) {
    previous = current;
    current = current.replace(innermost, (whole, _tag, attributes: string, inner: string) => {
      if (/crumb/i.test(attributes)) return "";
      const links = [...inner.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']*)["']/gi)].map((m) => m[1] ?? "");
      if (links.length >= 2 && links.every((href) => href.startsWith("#"))) return "";
      return whole;
    });
    if (current === previous) break;
  }
  return current;
}

export function htmlToMarkdown(html: string): string {
  const clean = sanitizeHtml(dropPageLists(html), {
    allowedTags: ARTICLE_TAGS,
    allowedAttributes: { a: ["href"], img: ["src", "alt"] },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { img: ["http", "https"] },
    // Dropped with everything inside them, not unwrapped into the text.
    nonTextTags: ["script", "style", "textarea", "option", "noscript", "nav", "header", "footer", "aside", "form", "svg"],
    transformTags: {
      // A paragraph a site styles as a heading is a heading.
      p: (tagName, attribs) => {
        const level = /(?:^|\s)h([1-6])(?:\s|$)/i.exec(attribs.class ?? "")?.[1];
        return { tagName: level ? `h${level}` : tagName, attribs: {} };
      },
    },
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

const decode = textOf;

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
