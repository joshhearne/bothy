import { describe, expect, it } from "vitest";
import { htmlToText, sanitizeRichText } from "./sanitize";

describe("sanitizeRichText", () => {
  it("keeps ordinary formatting", () => {
    const html = "<p>Hello <strong>world</strong></p><ul><li>one</li></ul>";
    expect(sanitizeRichText(html)).toBe(html);
  });

  it("drops script tags and their contents", () => {
    expect(sanitizeRichText('<p>ok</p><script>alert("xss")</script>')).toBe("<p>ok</p>");
  });

  it("drops event handler attributes", () => {
    expect(sanitizeRichText('<p onclick="steal()">hi</p>')).toBe("<p>hi</p>");
  });

  it("drops javascript: links but keeps the text", () => {
    expect(sanitizeRichText('<a href="javascript:alert(1)">click</a>')).toBe(
      '<a rel="noopener noreferrer nofollow">click</a>',
    );
  });

  it("keeps http links and hardens them", () => {
    const out = sanitizeRichText('<a href="https://example.com">x</a>');
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
  });

  it("drops iframes, styles, and forms", () => {
    const out = sanitizeRichText(
      '<iframe src="https://evil"></iframe><style>body{}</style><form><input/></form>',
    );
    expect(out).toBe("");
  });

  it("strips svg-based payloads", () => {
    expect(sanitizeRichText('<svg><script>alert(1)</script></svg>')).toBe("");
  });
});

describe("htmlToText", () => {
  it("returns the readable text", () => {
    expect(htmlToText("<p>Hello <strong>world</strong></p>")).toBe("Hello world");
  });

  it("collapses whitespace and decodes entities", () => {
    expect(htmlToText("<p>a &amp;  b</p>\n<p>c</p>")).toBe("a & b c");
  });

  it("returns an empty string for markup with no text", () => {
    expect(htmlToText("<p></p>")).toBe("");
  });
});
