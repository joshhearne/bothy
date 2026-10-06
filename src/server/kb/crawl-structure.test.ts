import { describe, expect, it } from "vitest";
import {
  breadcrumbs,
  canonicalAddress,
  isListing,
  isTrackingLink,
  placePages,
  type CrawledPage,
} from "./crawl-structure";

describe("canonicalAddress", () => {
  it("reads the page's own address, with the tracking and the slug gone", () => {
    const html = '<head><link rel="canonical" href="https://kb.example.com/articles/42"></head>';
    expect(canonicalAddress(html, "https://kb.example.com/articles/42-how-to?ref=x#top")).toBe(
      "https://kb.example.com/articles/42",
    );
    expect(canonicalAddress('<link href="/a/1" rel="canonical">', "https://kb.example.com/a/1-slug")).toBe(
      "https://kb.example.com/a/1",
    );
    expect(canonicalAddress("<head></head>", "https://kb.example.com/a")).toBeNull();
  });
});

describe("breadcrumbs", () => {
  it("prefers the structured trail and leaves the site and the page itself out", () => {
    const html = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[
      {"@type":"ListItem","position":1,"name":"Help Center","item":"https://kb.example.com/"},
      {"@type":"ListItem","position":2,"name":"Email Security","item":"https://kb.example.com/c/1"},
      {"@type":"ListItem","position":3,"name":"Spam filtering","item":"https://kb.example.com/s/2"},
      {"@type":"ListItem","position":4,"name":"Allowing a sender"}]}</script>`;
    expect(breadcrumbs(html, "Allowing a sender")).toEqual(["Email Security", "Spam filtering"]);
  });

  it("reads a drawn trail when there is no structured one", () => {
    const html = `<nav aria-label="Breadcrumbs"><ol><li><a href="/">Home</a></li><li><a href="/c">General &amp; Setup</a></li><li><a href="/s">Getting started</a></li><li>Signing in</li></ol></nav>`;
    expect(breadcrumbs(html, "Signing in")).toEqual(["General & Setup", "Getting started"]);
  });

  it("answers nothing for a page without one", () => {
    expect(breadcrumbs("<p>Just a page</p>", "Just a page")).toEqual([]);
  });
});

describe("isListing", () => {
  it("knows a page of links from a page of prose", () => {
    const menu = Array.from({ length: 12 }, (_, i) => `<li><a href="/a/${i}">Article number ${i} about something</a></li>`).join("");
    expect(isListing(`<h1>Email Security</h1><ul>${menu}</ul>`)).toBe(true);
    const prose = `<h1>Allowing a sender</h1>${"<p>Open the control panel and choose the sender you want to allow. Save and wait a minute.</p>".repeat(6)}<p>See <a href="/a/1">this</a> and <a href="/a/2">that</a>.</p>`;
    expect(isListing(prose)).toBe(false);
  });

  it("does not call a short page with a few links a listing", () => {
    expect(isListing('<p>See <a href="/a">a</a>, <a href="/b">b</a>, <a href="/c">c</a>.</p>')).toBe(false);
  });
});

describe("placePages", () => {
  const page = (url: string, title: string, over: Partial<CrawledPage> = {}): CrawledPage => ({
    url,
    title,
    crumbs: [],
    listing: false,
    links: [],
    ...over,
  });

  it("places an article by its breadcrumbs first", () => {
    const pages = [page("https://s/a/1", "Allowing a sender", { crumbs: ["Email Security", "Spam"] })];
    expect(placePages(pages, "https://s/").get("https://s/a/1")).toEqual({ category: "Email Security", subcategory: "Spam" });
  });

  it("places an article by the listings that lead to it, and leaves the start page out", () => {
    const pages = [
      page("https://s/", "Help", { listing: true, links: ["https://s/c/email", "https://s/c/backup"] }),
      page("https://s/c/email", "Email Security", { listing: true, links: ["https://s/s/spam", "https://s/a/9"] }),
      page("https://s/s/spam", "Spam filtering", { listing: true, links: ["https://s/a/1", "https://s/a/2"] }),
      page("https://s/c/backup", "Backup", { listing: true, links: ["https://s/a/3"] }),
      page("https://s/a/1", "Allowing a sender"),
      page("https://s/a/2", "Blocking a sender"),
      page("https://s/a/3", "Restoring a file"),
      page("https://s/a/9", "About email security"),
      page("https://s/a/lost", "Nobody links here"),
    ];
    const placed = placePages(pages, "https://s/");
    expect(placed.get("https://s/a/1")).toEqual({ category: "Email Security", subcategory: "Spam filtering" });
    expect(placed.get("https://s/a/2")).toEqual({ category: "Email Security", subcategory: "Spam filtering" });
    expect(placed.get("https://s/a/3")).toEqual({ category: "Backup", subcategory: null });
    expect(placed.get("https://s/a/9")).toEqual({ category: "Email Security", subcategory: null });
    expect(placed.get("https://s/a/lost")).toEqual({ category: null, subcategory: null });
    // Listings are not articles.
    expect(placed.has("https://s/c/email")).toBe(false);
  });

  it("takes the nearest listing when several link to the same article", () => {
    const pages = [
      page("https://s/c/email", "Email Security", { listing: true, links: ["https://s/s/spam", "https://s/a/1"] }),
      page("https://s/s/spam", "Spam filtering", { listing: true, links: ["https://s/a/1"] }),
      page("https://s/a/1", "Allowing a sender"),
    ];
    expect(placePages(pages, "https://s/").get("https://s/a/1")).toEqual({ category: "Email Security", subcategory: "Spam filtering" });
  });
});

describe("isTrackingLink", () => {
  it("knows a click-through from a page", () => {
    expect(isTrackingLink("https://s/hc/en-us/related/click?data=BAh7CjobZGVzdGluYXRpb25")).toBe(true);
    expect(isTrackingLink("https://s/out?u=https://elsewhere")).toBe(true);
    expect(isTrackingLink("https://s/hc/en-us/articles/123-title")).toBe(false);
    expect(isTrackingLink("https://s/kb?id=42")).toBe(false);
  });
});
