import { describe, expect, it } from "vitest";
import { disallowedPaths, isDisallowed, parseSitemap } from "./sitemap";

describe("parseSitemap", () => {
  it("reads pages and when they changed", () => {
    const sitemap = parseSitemap(`<?xml version="1.0"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>https://kb.example.com/a?x=1&amp;y=2</loc><lastmod>2026-03-01</lastmod></url>
        <url><loc><![CDATA[https://kb.example.com/b]]></loc></url>
      </urlset>`);

    expect(sitemap.pages).toEqual([
      { url: "https://kb.example.com/a?x=1&y=2", lastModified: new Date("2026-03-01") },
      { url: "https://kb.example.com/b", lastModified: null },
    ]);
    expect(sitemap.sitemaps).toEqual([]);
  });

  it("reads an index of sitemaps", () => {
    const sitemap = parseSitemap(
      "<sitemapindex><sitemap><loc>https://kb.example.com/s1.xml</loc></sitemap></sitemapindex>",
    );
    expect(sitemap.sitemaps).toEqual(["https://kb.example.com/s1.xml"]);
    expect(sitemap.pages).toEqual([]);
  });

  it("finds nothing in what is not a sitemap", () => {
    expect(parseSitemap("<html><body>404</body></html>")).toEqual({ pages: [], sitemaps: [] });
  });
});

describe("robots.txt", () => {
  const robots = `
    User-agent: *
    Disallow: /private/
    Disallow: /*.pdf$

    User-agent: bothy
    Disallow: /drafts/
  `;

  it("uses the rules for everyone", () => {
    expect(disallowedPaths(robots, "Crawler")).toEqual(["/private/", "/*.pdf$"]);
  });

  it("prefers the rules that name the product", () => {
    expect(disallowedPaths(robots, "Bothy")).toEqual(["/drafts/"]);
  });

  it("allows everything when nothing is disallowed", () => {
    expect(disallowedPaths("User-agent: *\nDisallow:\n", "Bothy")).toEqual([]);
  });

  it("matches by prefix and by pattern", () => {
    const rules = ["/private/", "/*.pdf$"];
    expect(isDisallowed("/private/a", rules)).toBe(true);
    expect(isDisallowed("/kb/guide.pdf", rules)).toBe(true);
    expect(isDisallowed("/kb/guide.pdf.html", rules)).toBe(false);
    expect(isDisallowed("/kb/a", rules)).toBe(false);
  });
});
