import { describe, expect, it } from "vitest";
import {
  brandNames,
  iconSize,
  isRasterIcon,
  isSvgIcon,
  parseBrandAssets,
  parseBrandHtml,
  parseBrandLogos,
  parseManifest,
  pickIcon,
  toHex,
} from "./brand";

const PAGE = "https://www.example.com/";

describe("parseBrandHtml", () => {
  const html = `<!doctype html><html><head>
    <title>  Example &amp; Co — Home </title>
    <meta name="theme-color" content="#0a7f5a">
    <meta property="og:image" content="/social.jpg">
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
    <link rel='shortcut icon' href='/favicon.ico'>
    <link rel="apple-touch-icon" sizes="180x180" href="https://cdn.example.com/touch.png">
    <link rel="manifest" href="/site.webmanifest">
    <link rel="stylesheet" href="/x.css">
  </head><body><link rel="icon" href="/not-in-head.png"></body></html>`;

  it("reads the title, colours, icons and manifest, resolving addresses", () => {
    const brand = parseBrandHtml(html, PAGE);
    expect(brand.title).toBe("Example & Co — Home");
    expect(brand.colors).toEqual(["#0a7f5a"]);
    expect(brand.manifestUrl).toBe("https://www.example.com/site.webmanifest");
    expect(brand.icons.map((i) => [i.source, i.url])).toEqual([
      ["icon", "https://www.example.com/favicon-32.png"],
      ["icon", "https://www.example.com/favicon.ico"],
      ["apple-touch-icon", "https://cdn.example.com/touch.png"],
      ["og:image", "https://www.example.com/social.jpg"],
    ]);
    expect(brand.icons[0]?.sizes).toBe("32x32");
    expect(brand.icons[0]?.type).toBe("image/png");
  });

  it("ignores the body and anything that is not a web address", () => {
    const brand = parseBrandHtml(
      `<head><link rel="icon" href="javascript:alert(1)"><link rel="icon" href="data:image/png;base64,AA=="></head><body><link rel="icon" href="/x.png"></body>`,
      PAGE,
    );
    expect(brand.icons).toEqual([]);
  });

  it("copes with a page that has nothing", () => {
    expect(parseBrandHtml("", PAGE)).toEqual({
      pageUrl: PAGE,
      title: null,
      colors: [],
      icons: [],
      manifestUrl: null,
    });
  });
});

describe("parseManifest", () => {
  it("adds the manifest's colours and icons, relative to the manifest", () => {
    const got = parseManifest(
      {
        theme_color: "rgb(10, 127, 90)",
        background_color: "#FFF",
        icons: [
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "x.svg" },
        ],
      },
      "https://www.example.com/site.webmanifest",
    );
    expect(got.colors).toEqual(["#0a7f5a", "#ffffff"]);
    expect(got.icons[0]).toEqual({
      url: "https://www.example.com/icon-512.png",
      source: "manifest",
      sizes: "512x512",
      type: "image/png",
    });
    expect(got.icons).toHaveLength(2);
  });

  it("gives nothing for a manifest that is not one", () => {
    expect(parseManifest("nope", PAGE)).toEqual({ colors: [], icons: [] });
    expect(parseManifest(null, PAGE)).toEqual({ colors: [], icons: [] });
  });
});

describe("toHex", () => {
  it("accepts hex and rgb(), refuses names", () => {
    expect(toHex("#ABC")).toBe("#aabbcc");
    expect(toHex("rgb(255, 0, 300)")).toBe("#ff00ff");
    expect(toHex("rebeccapurple")).toBeNull();
    expect(toHex(undefined)).toBeNull();
  });
});

describe("pickIcon", () => {
  const icon = (
    over: Partial<ReturnType<typeof parseBrandHtml>["icons"][number]>,
  ) => ({
    url: "https://x/a.png",
    source: "icon" as const,
    sizes: null,
    type: null,
    ...over,
  });

  it("prefers the largest usable raster, then the touch icon", () => {
    const chosen = pickIcon([
      icon({ url: "https://x/f.ico", type: "image/x-icon" }),
      icon({ url: "https://x/f32.png", sizes: "32x32" }),
      icon({
        url: "https://x/t.png",
        source: "apple-touch-icon",
        sizes: "180x180",
      }),
      icon({ url: "https://x/m.png", source: "manifest", sizes: "180x180" }),
      icon({ url: "https://x/og.jpg", source: "og:image" }),
    ]);
    expect(chosen?.url).toBe("https://x/t.png");
  });

  it("is null when only an ICO is offered, and takes an SVG over a small raster", () => {
    expect(
      pickIcon([icon({ url: "https://x/f.ico", type: "image/x-icon" })]),
    ).toBeNull();
    expect(
      pickIcon([
        icon({ url: "https://x/f32.png", sizes: "32x32" }),
        icon({ url: "https://x/a.svg" }),
      ])?.url,
    ).toBe("https://x/a.svg");
  });

  it("reads sizes and raster-ness", () => {
    expect(iconSize(icon({ sizes: "16x16 32x32 any" }))).toBe(32);
    expect(isRasterIcon(icon({ url: "https://x/a.webp?v=2" }))).toBe(true);
    expect(isRasterIcon(icon({ url: "https://x/a.svg" }))).toBe(false);
  });
});

describe("parseBrandLogos", () => {
  const page = `<!doctype html><html><head><title>Acme</title></head><body>
    <header>
      <a href="/"><img src="/assets/acme.svg" alt="Acme Widgets" width="160" height="40"></a>
      <nav><a href="/about">About</a></nav>
    </header>
    <section class="hero"><img src="/img/hero-office.jpg" alt="Our office"></section>
    <img class="site-logo" data-src="https://cdn.acme.com/brand/logo.png">
    <svg class="icon-cart" viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg>
    <footer>
      <svg aria-label="Acme logo" viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg>
      <img src="/img/badge-partner.png" alt="Partner badge">
      <svg class="logo"><use href="#sprite-logo"/></svg>
    </footer>
  </body></html>`;

  it("finds images named for the site or called a logo, and the mark drawn inline, best first", () => {
    const logos = parseBrandLogos(page, PAGE, brandNames("www.acme.com"));
    expect(logos.map((l) => [l.url, l.source, l.type])).toEqual([
      ["https://www.example.com/assets/acme.svg", "logo", "image/svg+xml"],
      ["https://cdn.acme.com/brand/logo.png", "logo", "image/png"],
      ["inline:2", "logo", "image/svg+xml"],
    ]);
    expect(logos[0]?.sizes).toBe("160x40");
    expect(logos[2]?.inline).toContain('aria-label="Acme logo"');
    expect(logos.some((l) => /hero|badge/.test(l.url))).toBe(false);
  });

  it("goes ahead of every head icon when picking", () => {
    const logos = parseBrandLogos(page, PAGE, brandNames("acme.com"));
    const head = parseBrandHtml(
      `<head><link rel="apple-touch-icon" sizes="180x180" href="/t.png"></head>`,
      PAGE,
    );
    expect(pickIcon([...head.icons, ...logos])?.url).toBe("https://www.example.com/assets/acme.svg");
    expect(isSvgIcon(logos[2]!)).toBe(true);
  });

  it("names the site by its hostname", () => {
    expect(brandNames("www.acme.com")).toEqual(["logo", "wordmark", "brandmark", "acme"]);
    expect(brandNames("shop.acme.co.uk")).toContain("acme");
    expect(brandNames("x.io")).toEqual(["logo", "wordmark", "brandmark"]);
  });
});

describe("parseBrandAssets", () => {
  it("lists the stylesheets and keeps the inline CSS", () => {
    const got = parseBrandAssets(
      `<head><link rel="stylesheet" href="/a.css"><link rel="preload" href="/b.css"><style>:root{--primary:#123456}</style></head><body><style>.x{color:red}</style></body>`,
      PAGE,
    );
    expect(got.stylesheets).toEqual(["https://www.example.com/a.css"]);
    expect(got.inlineCss).toContain("--primary:#123456");
    expect(got.inlineCss).toContain(".x{color:red}");
  });
});
