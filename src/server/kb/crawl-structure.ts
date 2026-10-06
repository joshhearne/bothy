/**
 * What a crawled page says about where it belongs, and which crawled pages
 * are not articles at all. A site that is not a help center still has a
 * structure; it is in the breadcrumbs, in the pages that only list other
 * pages, and in the addresses. Read here so a crawl ends with articles
 * under categories, not a pile of addresses.
 *
 * Nothing here fetches.
 */
import { textOf } from "./entities";

export type CrawledPage = {
  url: string;
  title: string;
  /** Names from the page's breadcrumb trail, the site's home left out. */
  crumbs: string[];
  /** The page is mostly links to other pages: a menu, a list, a category. */
  listing: boolean;
  /** Addresses this page links to, canonical. */
  links: string[];
};

export type Placement = { category: string | null; subcategory: string | null };

const decodeEntities = textOf;

/** What a page calls its own address, when it says: the one without the tracking and the slug. */
export function canonicalAddress(html: string, base: string): string | null {
  const match = /<link\b[^>]*\brel\s*=\s*["']canonical["'][^>]*\bhref\s*=\s*["']([^"']+)["']/i.exec(html)
    ?? /<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*\brel\s*=\s*["']canonical["']/i.exec(html);
  if (!match?.[1]) return null;
  try {
    const url = new URL(match[1].replace(/&amp;/g, "&").trim(), base);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

const HOME = /^(home|start|help center|help centre|support|knowledge base|kb|docs|documentation)$/i;

/**
 * The breadcrumb trail, as names: the structured one a page publishes for
 * search engines when it has one, else the one it draws. The first crumb is
 * dropped when it is the site itself, and the last when it is this page.
 */
export function breadcrumbs(html: string, title: string | null): string[] {
  let names: string[] = [];

  for (const block of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data: unknown = JSON.parse(block[1] ?? "");
      const list = findBreadcrumbList(data);
      if (list) {
        names = list;
        break;
      }
    } catch {
      // Not JSON, or not for us.
    }
  }

  if (names.length === 0) {
    const nav =
      /<(?:nav|ol|ul|div)\b[^>]*(?:aria-label\s*=\s*["'][^"']*breadcrumb[^"']*["']|class\s*=\s*["'][^"']*breadcrumb[^"']*["'])[^>]*>([\s\S]*?)<\/(?:nav|ol|ul|div)>/i.exec(html);
    if (nav?.[1]) {
      names = [...nav[1].matchAll(/<(?:a|li|span)\b[^>]*>([\s\S]*?)<\/(?:a|li|span)>/gi)]
        .map((m) => decodeEntities(m[1] ?? ""))
        .filter((name) => name !== "" && !/^[>›»\/|-]+$/.test(name));
      // Nested tags give the same name twice in a row.
      names = names.filter((name, index) => name !== names[index - 1]);
    }
  }

  if (names.length > 0 && HOME.test(names[0] ?? "")) names = names.slice(1);
  if (names.length > 0 && title && same(names[names.length - 1] ?? "", title)) names = names.slice(0, -1);
  return names.slice(0, 4);
}

function findBreadcrumbList(data: unknown): string[] | null {
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = findBreadcrumbList(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;
  if (record["@type"] === "BreadcrumbList" && Array.isArray(record.itemListElement)) {
    const names = (record.itemListElement as Record<string, unknown>[])
      .slice()
      .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
      .map((element) => {
        const item = element.item;
        const name = element.name ?? (typeof item === "object" && item !== null ? (item as Record<string, unknown>).name : undefined);
        return typeof name === "string" ? decodeEntities(name) : "";
      })
      .filter((name) => name !== "");
    return names.length > 0 ? names : null;
  }
  if (Array.isArray(record["@graph"])) return findBreadcrumbList(record["@graph"]);
  return null;
}

function same(a: string, b: string): boolean {
  const fold = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return fold(a) === fold(b);
}

/**
 * Whether a page is mostly a way to other pages: a category, a section, a
 * table of contents. Judged on the part of the page that would be the
 * article: how much of its text sits inside links, and how little is left.
 */
export function isListing(mainHtml: string): boolean {
  // A page whose content is a video has little to say in words.
  if (/<(?:iframe|video)\b/i.test(mainHtml)) return false;
  const text = decodeEntities(mainHtml);
  const linked = [...mainHtml.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => decodeEntities(m[1] ?? ""));
  const links = linked.filter((t) => t !== "").length;
  if (links < 5) return false;
  const linkedChars = linked.reduce((sum, t) => sum + t.length, 0);
  const total = Math.max(text.length, 1);
  return linkedChars / total >= 0.6 || total - linkedChars < 200;
}

/**
 * Where each article belongs, from its own breadcrumbs when it has them, and
 * otherwise from the listing pages that lead to it: the listing that links
 * it names its section, and the listing that links that one names its
 * category. The page the crawl started from is the site, not a category.
 */
export function placePages(pages: CrawledPage[], start: string): Map<string, Placement> {
  const listings = pages.filter((page) => page.listing && page.url !== start);

  // Who links to whom, among the listings only.
  const linkedBy = new Map<string, CrawledPage[]>();
  for (const listing of listings) {
    for (const target of listing.links) {
      if (target === listing.url) continue;
      const list = linkedBy.get(target) ?? [];
      if (!list.includes(listing)) list.push(listing);
      linkedBy.set(target, list);
    }
  }

  // A listing's parent is a listing that links to it; the start page does not count.
  const parentOf = (listing: CrawledPage): CrawledPage | null =>
    (linkedBy.get(listing.url) ?? []).find((candidate) => candidate.url !== listing.url) ?? null;

  const placements = new Map<string, Placement>();
  for (const page of pages) {
    if (page.listing) continue;

    if (page.crumbs.length > 0) {
      placements.set(page.url, {
        category: page.crumbs[0] ?? null,
        subcategory: page.crumbs.length > 1 ? page.crumbs.slice(1).join(" › ") : null,
      });
      continue;
    }

    const parents = linkedBy.get(page.url) ?? [];
    // Among several listings that link here, the deepest one is the nearest.
    const nearest = parents
      .map((listing) => ({ listing, depth: depthOf(listing, parentOf) }))
      .sort((a, b) => b.depth - a.depth)[0]?.listing;
    if (!nearest) {
      placements.set(page.url, { category: null, subcategory: null });
      continue;
    }
    const grand = parentOf(nearest);
    placements.set(
      page.url,
      grand && grand.url !== nearest.url
        ? { category: grand.title, subcategory: nearest.title }
        : { category: nearest.title, subcategory: null },
    );
  }

  return placements;
}

function depthOf(listing: CrawledPage, parentOf: (listing: CrawledPage) => CrawledPage | null): number {
  let depth = 0;
  let current: CrawledPage | null = listing;
  const seen = new Set<string>();
  while (current && !seen.has(current.url) && depth < 10) {
    seen.add(current.url);
    current = parentOf(current);
    if (current) depth += 1;
  }
  return depth;
}

/**
 * Addresses that lead to a site's furniture rather than to articles: tag,
 * category, author, and date archives, and the later pages of any of them.
 * Fetched after everything else, so a crawl with a cap reaches the articles
 * first, and never kept as articles.
 */
export function isArchiveAddress(address: string): boolean {
  try {
    const url = new URL(address);
    if (/\/(?:tag|tags|category|categories|author|topics?|label|archives?)\/|\/page\/\d+(?:\/|$)|\/\d{4}\/\d{2}\/?$/i.test(url.pathname)) {
      return true;
    }
    return /(?:^|[?&])(?:paged|page|s|tag|cat|author|m)=/.test(url.search);
  } catch {
    return true;
  }
}

/**
 * Whether a page says it is an archive: a list of posts by tag, category,
 * author, or date, or a page of search results. Sites built on the common
 * publishing platforms mark the body of such a page with those words.
 */
export function isArchivePage(html: string): boolean {
  const body = /<body\b[^>]*\bclass\s*=\s*["']([^"']*)["']/i.exec(html)?.[1] ?? "";
  return /(?:^|\s)(?:archive|tag|category|search-results|search|paged|date|author)(?:\s|$)/i.test(body);
}

/** Addresses that are not pages: click-through redirects and tracking links. */
export function isTrackingLink(address: string): boolean {
  try {
    const url = new URL(address);
    if (/\/(?:click|redirect|track|goto|out)(?:\/|$)/i.test(url.pathname)) return true;
    if (url.search.length > 160) return true;
    return false;
  } catch {
    return true;
  }
}

/**
 * Addresses whose pages say the same thing as two or more others. A site
 * shows one notice wherever there is nothing: an empty tag, a page that
 * moved. Three identical pages are that notice, not three articles.
 */
export function repeatedNotices(pages: { url: string; text: string }[]): Set<string> {
  const byText = new Map<string, string[]>();
  for (const page of pages) {
    const list = byText.get(page.text) ?? [];
    list.push(page.url);
    byText.set(page.text, list);
  }
  const notices = new Set<string>();
  for (const urls of byText.values()) if (urls.length >= 3) for (const url of urls) notices.add(url);
  return notices;
}
