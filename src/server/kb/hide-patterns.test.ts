import { describe, expect, it } from "vitest";
import { compilePattern, globToRegex, splitPatterns } from "./hide-patterns";

describe("globToRegex", () => {
  it("reads * and ? and keeps the rest literal", () => {
    const regex = new RegExp(globToRegex("guide-*.p?f"), "i");
    expect(regex.test("guide-2024.pdf")).toBe(true);
    expect(regex.test("Guide-x.PDF")).toBe(true);
    expect(regex.test("guide.pdf")).toBe(false);
    expect(new RegExp(globToRegex("a+b.txt")).test("a+b.txt")).toBe(true);
    expect(new RegExp(globToRegex("a+b.txt")).test("aab.txt")).toBe(false);
  });
});

describe("compilePattern", () => {
  it("escapes a literal for titles and reads it as a glob for files", () => {
    const { regex, fileRegex } = compilePattern("*.pdf", false);
    expect(new RegExp(regex, "i").test("Why *.pdf matters")).toBe(true);
    expect(new RegExp(fileRegex, "i").test("manual.pdf")).toBe(true);
    expect(new RegExp(fileRegex, "i").test("manual.pdf.txt")).toBe(false);
  });

  it("takes a bare word as a type for files: the type itself, or a name ending in it", () => {
    const { fileRegex } = compilePattern(".docx", false);
    const file = new RegExp(fileRegex, "i");
    expect(file.test("docx")).toBe(true);
    expect(file.test("notes.docx")).toBe(true);
    expect(file.test("docx-notes.md")).toBe(false);
  });

  it("passes a regular expression through", () => {
    expect(compilePattern(" ^admin.*$ ", true)).toEqual({ regex: "^admin.*$", fileRegex: "^admin.*$" });
  });
});

describe("splitPatterns", () => {
  it("splits lines, and literal lines again on tabs and commas, dropping blanks and repeats", () => {
    expect(splitPatterns("admin, Admin\tbilling\n\n*.pdf,*.docx\n", false)).toEqual(["admin", "billing", "*.pdf", "*.docx"]);
  });

  it("keeps a regular expression's commas", () => {
    expect(splitPatterns("^v[0-9]{2,3}$\tadmin", true)).toEqual(["^v[0-9]{2,3}$", "admin"]);
  });
});
