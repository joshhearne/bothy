/**
 * Reading a sitemap and a robots.txt. Both are small, regular formats, so
 * they are read with patterns rather than a parser.
 */

export type SitemapEntry = { url: string; lastModified: Date | null };

export type Sitemap = { pages: SitemapEntry[]; sitemaps: string[] };

function unescape(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

function tag(block: string, name: string): string | null {
  const match = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(block);
  return match?.[1] ? unescape(match[1]) : null;
}

export function parseSitemap(xml: string): Sitemap {
  const result: Sitemap = { pages: [], sitemaps: [] };

  for (const match of xml.matchAll(/<sitemap\b[^>]*>([\s\S]*?)<\/sitemap>/gi)) {
    const loc = tag(match[1] ?? "", "loc");
    if (loc) result.sitemaps.push(loc);
  }

  for (const match of xml.matchAll(/<url\b[^>]*>([\s\S]*?)<\/url>/gi)) {
    const loc = tag(match[1] ?? "", "loc");
    if (!loc) continue;

    const lastmod = tag(match[1] ?? "", "lastmod");
    const date = lastmod ? new Date(lastmod) : null;
    result.pages.push({
      url: loc,
      lastModified: date && !Number.isNaN(date.getTime()) ? date : null,
    });
  }

  return result;
}

/**
 * The paths robots.txt asks everyone, or this product by name, to stay out
 * of. A group naming the product replaces the one for everyone, as the
 * convention has it.
 */
export function disallowedPaths(robots: string, product: string): string[] {
  const groups = new Map<string, string[]>();
  let agents: string[] = [];
  let inRules = false;

  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const colon = line.indexOf(":");
    if (colon === -1) continue;

    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === "user-agent") {
      if (inRules) agents = [];
      inRules = false;
      agents.push(value.toLowerCase());
      for (const agent of agents) if (!groups.has(agent)) groups.set(agent, []);
    } else if (field === "disallow" || field === "allow") {
      inRules = true;
      if (field === "disallow" && value !== "") {
        for (const agent of agents) groups.get(agent)?.push(value);
      }
    }
  }

  const name = product.toLowerCase();
  const own = [...groups.entries()].find(([agent]) => agent !== "*" && name.includes(agent));
  return own?.[1] ?? groups.get("*") ?? [];
}

export function isDisallowed(path: string, disallowed: string[]): boolean {
  return disallowed.some((rule) => {
    if (!rule.includes("*") && !rule.endsWith("$")) return path.startsWith(rule);
    const pattern = rule
      .replace(/[.+?^{}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\\?\$$/, "$");
    return new RegExp(`^${pattern}`).test(path);
  });
}
