/**
 * What a website says about its own look, read from the head of its front
 * page: a title, a theme colour, the icons it offers browsers, a social
 * image, and a web app manifest that may carry more of each. Pure parsing;
 * the page and the manifest are fetched elsewhere.
 *
 * The head is other people's HTML, so this is tolerant and bounded: tags are
 * read with patterns, never executed, and only so many are kept.
 */

import { normalizeHex } from "@/lib/brand-color";

export type IconSource =
  | "logo"
  | "icon"
  | "apple-touch-icon"
  | "og:image"
  | "manifest";

export type BrandIcon = {
  /** Where it is; for a logo drawn into the page itself, "inline:" and a number. */
  url: string;
  source: IconSource;
  /** "180x180" as declared, or null. */
  sizes: string | null;
  /** Declared type, lower case, or null. */
  type: string | null;
  /** The markup of a logo drawn into the page as SVG, bounded; rendered when applied. */
  inline?: string;
};

export type BrandSummary = {
  /** The page this came from, after redirects. */
  pageUrl: string;
  title: string | null;
  /** Hex colours, theme-color first, then the manifest's, distinct. */
  colors: string[];
  icons: BrandIcon[];
  manifestUrl: string | null;
};

const MAX_ICONS = 16;
/** How much of the page's body is read for logos. */
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_LOGOS = 4;
const MAX_INLINE_SVG_BYTES = 64 * 1024;

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const pattern =
    /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(tag)) !== null) {
    const name = match[1]?.toLowerCase();
    if (name && !(name in out))
      out[name] = (match[2] ?? match[3] ?? match[4] ?? "").trim();
  }
  return out;
}

function decode(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function resolve(href: string, base: string): string | null {
  try {
    const url = new URL(decode(href), base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

/** A colour as CSS might state it, as hex, or null. rgb() is accepted; names are not. */
export function toHex(value: string | undefined): string | null {
  if (!value) return null;
  const hex = normalizeHex(value);
  if (hex) return hex;
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i.exec(
    value.trim(),
  );
  if (!rgb) return null;
  const part = (n: string) =>
    Math.min(255, Number(n)).toString(16).padStart(2, "0");
  return `#${part(rgb[1]!)}${part(rgb[2]!)}${part(rgb[3]!)}`;
}

/** The head of the page: everything before <body>, or the first 256 KB. */
function headOf(html: string): string {
  const cut = html.search(/<body[\s>]/i);
  const head = cut === -1 ? html : html.slice(0, cut);
  return head.slice(0, 256 * 1024);
}

export function parseBrandHtml(html: string, pageUrl: string): BrandSummary {
  const head = headOf(html);
  const icons: BrandIcon[] = [];
  const colors: string[] = [];
  let title: string | null = null;
  let manifestUrl: string | null = null;

  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head);
  if (titleMatch?.[1]) title = decode(titleMatch[1]).slice(0, 200) || null;

  const push = (icon: BrandIcon) => {
    if (icons.length >= MAX_ICONS) return;
    if (icons.some((seen) => seen.url === icon.url)) return;
    icons.push(icon);
  };
  const addColor = (value: string | undefined) => {
    const hex = toHex(value);
    if (hex && !colors.includes(hex)) colors.push(hex);
  };

  for (const tag of head.match(/<link\b[^>]*>/gi) ?? []) {
    const a = attrs(tag);
    const rel = (a.rel ?? "").toLowerCase().split(/\s+/);
    const href = a.href ? resolve(a.href, pageUrl) : null;
    if (!href) continue;
    if (rel.includes("manifest")) {
      manifestUrl ??= href;
    } else if (
      rel.includes("apple-touch-icon") ||
      rel.includes("apple-touch-icon-precomposed")
    ) {
      push({
        url: href,
        source: "apple-touch-icon",
        sizes: a.sizes ?? null,
        type: a.type?.toLowerCase() ?? null,
      });
    } else if (rel.includes("icon")) {
      push({
        url: href,
        source: "icon",
        sizes: a.sizes ?? null,
        type: a.type?.toLowerCase() ?? null,
      });
    }
  }

  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const a = attrs(tag);
    const name = (a.name ?? a.property ?? "").toLowerCase();
    if (name === "theme-color") addColor(a.content);
    else if (name === "msapplication-tilecolor") addColor(a.content);
    else if (
      name === "og:image" ||
      name === "og:image:url" ||
      name === "twitter:image"
    ) {
      const url = a.content ? resolve(a.content, pageUrl) : null;
      if (url) push({ url, source: "og:image", sizes: null, type: null });
    }
  }

  return { pageUrl, title, colors, icons, manifestUrl };
}

/** What a web app manifest adds: its colours and its icons. Tolerant of anything. */
export function parseManifest(
  json: unknown,
  manifestUrl: string,
): { colors: string[]; icons: BrandIcon[] } {
  const colors: string[] = [];
  const icons: BrandIcon[] = [];
  if (!json || typeof json !== "object") return { colors, icons };
  const m = json as Record<string, unknown>;

  for (const key of ["theme_color", "background_color"]) {
    const hex = typeof m[key] === "string" ? toHex(m[key] as string) : null;
    if (hex && !colors.includes(hex)) colors.push(hex);
  }
  if (Array.isArray(m.icons)) {
    for (const entry of m.icons.slice(0, MAX_ICONS)) {
      if (!entry || typeof entry !== "object") continue;
      const icon = entry as Record<string, unknown>;
      const url =
        typeof icon.src === "string" ? resolve(icon.src, manifestUrl) : null;
      if (!url || icons.some((seen) => seen.url === url)) continue;
      icons.push({
        url,
        source: "manifest",
        sizes: typeof icon.sizes === "string" ? icon.sizes : null,
        type: typeof icon.type === "string" ? icon.type.toLowerCase() : null,
      });
    }
  }
  return { colors, icons };
}

/** Everything the page links or carries that paints it: stylesheet addresses and inline CSS. */
export function parseBrandAssets(
  html: string,
  pageUrl: string,
): { stylesheets: string[]; inlineCss: string } {
  const text = html.slice(0, MAX_BODY_BYTES);
  const stylesheets: string[] = [];
  for (const tag of text.match(/<link\b[^>]*>/gi) ?? []) {
    const a = attrs(tag);
    const rel = (a.rel ?? "").toLowerCase().split(/\s+/);
    if (!rel.includes("stylesheet") || !a.href) continue;
    const href = resolve(a.href, pageUrl);
    if (href && !stylesheets.includes(href)) stylesheets.push(href);
    if (stylesheets.length >= 4) break;
  }
  const inlineCss = (text.match(/<style\b[^>]*>([\s\S]*?)<\/style>/gi) ?? [])
    .map((block) => block.replace(/^<style\b[^>]*>/i, "").replace(/<\/style>$/i, ""))
    .join("\n");
  return { stylesheets, inlineCss };
}

/**
 * The names a logo file might carry: "logo" itself, and the site's own name
 * as its hostname spells it, so acme.com's /images/acme.svg is found.
 */
export function brandNames(domain: string): string[] {
  const labels = domain
    .toLowerCase()
    .split(".")
    .filter((label) => label && label !== "www");
  // The site's own label: the rightmost one that is not the suffix, nor a
  // short second level like the "co" of co.uk.
  const own = labels
    .slice(0, -1)
    .reverse()
    .find((label) => label.length >= 4);
  const names = ["logo", "wordmark", "brandmark"];
  if (own && !names.includes(own)) names.push(own);
  return names;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The file name without its extension, lower case, or "". */
function stemOf(url: string): string {
  try {
    const path = new URL(url).pathname;
    const file = path.split("/").pop() ?? "";
    return file.replace(/\.[a-z0-9]+$/i, "").toLowerCase();
  } catch {
    return "";
  }
}

function typeFromUrl(url: string): string | null {
  const m = /\.(png|jpe?g|webp|svg|gif|ico)(\?|$)/i.exec(url);
  if (!m) return null;
  const ext = m[1]!.toLowerCase();
  if (ext === "svg") return "image/svg+xml";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "ico") return "image/x-icon";
  return `image/${ext}`;
}

/** Whether a tag sits just inside a link to the site's front page: where a logo lives. */
function underHomeLink(text: string, at: number): boolean {
  const before = text.slice(Math.max(0, at - 400), at);
  return /<a\b[^>]*href\s*=\s*["']?(?:\/|\.\/|index\.[a-z]+|https?:\/\/[^"'\s/>]+\/?)["'\s>][^>]*>(?:\s*<[^a][^>]*>)*\s*$/i.test(
    before,
  );
}

/**
 * The logos the page itself shows: images named for it — logo.svg, acme.png —
 * or described as one by alt, class or id, or sitting inside the link home at
 * the top of the page; and marks drawn inline as SVG the same way. Hero
 * pictures and footer badges fail those tests. The best few, best first.
 */
export function parseBrandLogos(
  html: string,
  pageUrl: string,
  names: string[],
): BrandIcon[] {
  const text = html.slice(0, MAX_BODY_BYTES);
  const nameTest = new RegExp(
    `(^|[^a-z0-9])(${names.map(escapeRegex).join("|")})([^a-z0-9]|$)`,
    "i",
  );
  const describedTest = /logo|wordmark|brandmark|site-?brand|navbar-brand/i;
  const found: { icon: BrandIcon; score: number; at: number }[] = [];

  let seen = 0;
  for (const m of text.matchAll(/<img\b[^>]*>/gi)) {
    if (seen++ >= 400) break;
    const a = attrs(m[0]);
    const raw =
      a.src ??
      a["data-src"] ??
      a["data-lazy-src"] ??
      (a.srcset ?? a["data-srcset"])?.split(",")[0]?.trim().split(/\s+/)[0];
    const url = raw ? resolve(raw, pageUrl) : null;
    if (!url) continue;
    const type = a.type?.toLowerCase() ?? typeFromUrl(url);
    if (type === "image/gif" || type === "image/x-icon") continue;

    let score = 0;
    const stem = stemOf(url);
    if (nameTest.test(stem)) score += 3;
    const described = [a.alt, a.class, a.id, a.title, a["aria-label"]]
      .filter(Boolean)
      .join(" ");
    if (describedTest.test(described) || nameTest.test(described)) score += 2;
    if (underHomeLink(text, m.index ?? 0)) score += 2;
    if (score === 0) continue;

    const w = Number(a.width);
    const h = Number(a.height);
    found.push({
      icon: {
        url,
        source: "logo",
        sizes: w > 0 && h > 0 ? `${w}x${h}` : null,
        type,
      },
      score,
      at: m.index ?? 0,
    });
  }

  let inlineCount = 0;
  for (const m of text.matchAll(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi)) {
    if (inlineCount >= 20) break;
    inlineCount += 1;
    const markup = m[0];
    if (markup.length > MAX_INLINE_SVG_BYTES) continue;
    const open = /^<svg\b[^>]*>/i.exec(markup)?.[0] ?? "";
    const a = attrs(open);
    const described = [a.class, a.id, a["aria-label"], a["data-name"]]
      .filter(Boolean)
      .join(" ");
    const title = /<title[^>]*>([^<]{0,100})<\/title>/i.exec(markup)?.[1] ?? "";
    let score = 0;
    if (describedTest.test(described) || nameTest.test(described)) score += 2;
    if (describedTest.test(title) || nameTest.test(title)) score += 2;
    if (underHomeLink(text, m.index ?? 0)) score += 2;
    // A sprite reference draws nothing on its own.
    if (score === 0 || /<use\b/i.test(markup)) continue;
    found.push({
      icon: {
        url: `inline:${found.length}`,
        source: "logo",
        sizes: null,
        type: "image/svg+xml",
        inline: markup,
      },
      score,
      at: m.index ?? 0,
    });
  }

  return found
    .sort((a, b) => b.score - a.score || a.at - b.at)
    .filter((entry, index, all) => all.findIndex((other) => other.icon.url === entry.icon.url) === index)
    .slice(0, MAX_LOGOS)
    .map((entry) => entry.icon);
}

/** The declared size's larger side, or 0 when unknown. "any" counts as unknown. */
export function iconSize(icon: BrandIcon): number {
  if (!icon.sizes) return 0;
  let best = 0;
  for (const part of icon.sizes.toLowerCase().split(/\s+/)) {
    const m = /^(\d+)x(\d+)$/.exec(part);
    if (m) best = Math.max(best, Number(m[1]), Number(m[2]));
  }
  return best;
}

/** True for a format a logo may be: PNG, JPEG or WebP by declared type or extension. */
export function isRasterIcon(icon: BrandIcon): boolean {
  if (icon.type)
    return ["image/png", "image/jpeg", "image/jpg", "image/webp"].includes(
      icon.type,
    );
  return /\.(png|jpe?g|webp)(\?|$)/i.test(icon.url);
}

/** An SVG, which is rendered to PNG when applied. */
export function isSvgIcon(icon: BrandIcon): boolean {
  if (icon.inline !== undefined) return true;
  if (icon.type) return icon.type === "image/svg+xml";
  return /\.svg(\?|$)/i.test(icon.url);
}

/** What can become a logo: a raster, or an SVG rendered to one. */
export function isUsableIcon(icon: BrandIcon): boolean {
  return isRasterIcon(icon) || isSvgIcon(icon);
}

/** How large the icon reads for choosing: its declared size, or, for an SVG, as large as it is rendered. */
function effectiveSize(icon: BrandIcon): number {
  return isSvgIcon(icon) ? 512 : iconSize(icon);
}

/**
 * The icon most likely to serve as a logo: the logo the page itself shows,
 * first of all, in the order the page reader ranked them; failing that a
 * usable raster, the largest declared, preferring the touch icon and the
 * manifest's over a favicon and a social image, which is often a photo.
 */
export function pickIcon(icons: BrandIcon[]): BrandIcon | null {
  const rank: Record<IconSource, number> = {
    logo: 4,
    "apple-touch-icon": 3,
    manifest: 2,
    icon: 1,
    "og:image": 0,
  };
  const usable = icons.filter(isUsableIcon);
  if (usable.length === 0) return null;
  const logo = usable.find((icon) => icon.source === "logo");
  if (logo) return logo;
  return (
    [...usable].sort(
      (a, b) =>
        effectiveSize(b) - effectiveSize(a) || rank[b.source] - rank[a.source],
    )[0] ?? null
  );
}
