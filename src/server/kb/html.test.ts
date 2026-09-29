import { describe, expect, it } from "vitest";
import { htmlToMarkdown, mainContent, pageLinks, pageTitle } from "./html";

describe("htmlToMarkdown", () => {
  it("keeps what an article is made of", () => {
    expect(
      htmlToMarkdown('<h2>Setup</h2><p>Open <a href="https://example.com/x">the page</a>.</p><ul><li>One</li></ul>'),
    ).toBe("## Setup\n\nOpen [the page](https://example.com/x).\n\n-   One");
  });

  it("drops scripts, styles, and navigation with what is inside them", () => {
    const markdown = htmlToMarkdown(
      "<nav><a href='/'>Home</a></nav><script>steal()</script><style>p{}</style><p>Text</p>",
    );
    expect(markdown).toBe("Text");
  });

  it("drops a link that would run script", () => {
    expect(htmlToMarkdown('<p><a href="javascript:alert(1)">x</a></p>')).not.toContain("javascript");
  });
});

describe("mainContent", () => {
  it("prefers the article when the page marks one", () => {
    const text = "word ".repeat(60);
    expect(mainContent(`<body><nav>n</nav><article><p>${text}</p></article></body>`)).toBe(
      `<p>${text}</p>`,
    );
  });

  it("falls back to the body", () => {
    expect(mainContent("<html><body><p>Short</p></body></html>")).toBe("<p>Short</p>");
  });
});

describe("pageTitle", () => {
  it("prefers the heading to the tab title", () => {
    expect(pageTitle("<title>KB | Site</title><h1>Exporting <em>reports</em> &amp; more</h1>")).toBe(
      "Exporting reports & more",
    );
    expect(pageTitle("<title>Only this</title>")).toBe("Only this");
    expect(pageTitle("<p>none</p>")).toBeNull();
  });
});

describe("pageLinks", () => {
  it("resolves links against the page and drops fragments", () => {
    expect(
      pageLinks(
        '<a href="/kb/a#top">a</a> <a href="b?x=1&amp;y=2">b</a> <a href="#x">x</a> <a href="mailto:a@b.c">m</a>',
        "https://example.com/kb/",
      ),
    ).toEqual(["https://example.com/kb/a", "https://example.com/kb/b?x=1&y=2"]);
  });
});
