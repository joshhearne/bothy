import { describe, expect, it } from "vitest";
import { asDate, asText, parseFrontmatter } from "./frontmatter";

describe("parseFrontmatter", () => {
  it("separates metadata from the article", () => {
    const { data, body } = parseFrontmatter(
      '---\ntitle: "Exporting a report"\narticle_id: 4821\ndoc_attachments: ["a.pdf"]\n---\n\n# Heading\n\nText.\n',
    );
    expect(data).toMatchObject({ title: "Exporting a report", article_id: 4821 });
    expect(data.doc_attachments).toEqual(["a.pdf"]);
    expect(body).toBe("# Heading\n\nText.\n");
  });

  it("leaves a file with no frontmatter alone", () => {
    expect(parseFrontmatter("# Only a body\n")).toEqual({ data: {}, body: "# Only a body\n" });
  });

  it("treats an unclosed rule as part of the article", () => {
    const source = "---\nnot: closed\n\nText";
    expect(parseFrontmatter(source)).toEqual({ data: {}, body: source });
  });

  it("keeps the body when the metadata does not parse", () => {
    const { data, body } = parseFrontmatter("---\ntitle: [unclosed\n---\nText");
    expect(data).toEqual({});
    expect(body).toBe("Text");
  });

  it("reads Windows line endings and a byte order mark", () => {
    const { data, body } = parseFrontmatter("﻿---\r\ntitle: A\r\n---\r\nText\r\n");
    expect(data).toEqual({ title: "A" });
    expect(body).toBe("Text\n");
  });

  it("does not end the metadata at a rule inside a value", () => {
    const { data } = parseFrontmatter('---\ntitle: "a --- b"\nurl: https://example.com\n---\nText');
    expect(data).toEqual({ title: "a --- b", url: "https://example.com" });
  });
});

describe("asText", () => {
  it("accepts a numeric id as text", () => {
    expect(asText(4821)).toBe("4821");
  });

  it("treats blank and non-scalar values as absent", () => {
    expect(asText("  ")).toBeNull();
    expect(asText(["a"])).toBeNull();
  });
});

describe("asDate", () => {
  it("reads a calendar date as midnight UTC", () => {
    expect(asDate("2025-11-11")?.toISOString()).toBe("2025-11-11T00:00:00.000Z");
  });

  it("reads a timestamp to the millisecond", () => {
    expect(asDate("2025-11-11T21:40:52.147Z")?.getTime()).toBe(Date.UTC(2025, 10, 11, 21, 40, 52, 147));
  });

  it("refuses what is not a date", () => {
    expect(asDate("last Tuesday")).toBeNull();
    expect(asDate(null)).toBeNull();
  });
});
