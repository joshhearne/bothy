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

export type IconSource = "icon" | "apple-touch-icon" | "og:image" | "manifest";

export type BrandIcon = {
  url: string;
  source: IconSource;
  /** "180x180" as declared, or null. */
  sizes: string | null;
  /** Declared type, lower case, or null. */
  type: string | null;
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

const MAX_ICONS = 12;

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(tag)) !== null) {
    const name = match[1]?.toLowerCase();
    if (name && !(name in out)) out[name] = (match[2] ?? match[3] ?? match[4] ?? "").trim();
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
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i.exec(value.trim());
  if (!rgb) return null;
  const part = (n: string) => Math.min(255, Number(n)).toString(16).padStart(2, "0");
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
    } else if (rel.includes("apple-touch-icon") || rel.includes("apple-touch-icon-precomposed")) {
      push({ url: href, source: "apple-touch-icon", sizes: a.sizes ?? null, type: a.type?.toLowerCase() ?? null });
    } else if (rel.includes("icon")) {
      push({ url: href, source: "icon", sizes: a.sizes ?? null, type: a.type?.toLowerCase() ?? null });
    }
  }

  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const a = attrs(tag);
    const name = (a.name ?? a.property ?? "").toLowerCase();
    if (name === "theme-color") addColor(a.content);
    else if (name === "msapplication-tilecolor") addColor(a.content);
    else if (name === "og:image" || name === "og:image:url" || name === "twitter:image") {
      const url = a.content ? resolve(a.content, pageUrl) : null;
      if (url) push({ url, source: "og:image", sizes: null, type: null });
    }
  }

  return { pageUrl, title, colors, icons, manifestUrl };
}

/** What a web app manifest adds: its colours and its icons. Tolerant of anything. */
export function parseManifest(json: unknown, manifestUrl: string): { colors: string[]; icons: BrandIcon[] } {
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
      const url = typeof icon.src === "string" ? resolve(icon.src, manifestUrl) : null;
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
  if (icon.type) return ["image/png", "image/jpeg", "image/jpg", "image/webp"].includes(icon.type);
  return /\.(png|jpe?g|webp)(\?|$)/i.test(icon.url);
}

/**
 * The icon most likely to serve as a logo: a usable raster, the largest
 * declared, preferring the touch icon and the manifest's over a favicon and
 * a social image, which is often a photo.
 */
export function pickIcon(icons: BrandIcon[]): BrandIcon | null {
  const rank: Record<IconSource, number> = { "apple-touch-icon": 3, manifest: 2, icon: 1, "og:image": 0 };
  const usable = icons.filter(isRasterIcon);
  if (usable.length === 0) return null;
  return [...usable].sort((a, b) => iconSize(b) - iconSize(a) || rank[b.source] - rank[a.source])[0] ?? null;
}
