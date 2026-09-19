import { describe, expect, it } from "vitest";
import { contentDisposition, sanitizeFilename } from "./filename";

describe("sanitizeFilename", () => {
  it("keeps an ordinary name", () => {
    expect(sanitizeFilename("switch-config.txt")).toBe("switch-config.txt");
  });

  it("drops path segments", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("C:\\windows\\system32\\evil.dll")).toBe("evil.dll");
  });

  it("drops control characters", () => {
    expect(sanitizeFilename("we\u0000ird\u001fname.pdf")).toBe("weirdname.pdf");
  });

  it("refuses to produce a dotfile", () => {
    expect(sanitizeFilename("...hidden")).toBe("hidden");
  });

  it("falls back when nothing is left", () => {
    expect(sanitizeFilename("   ")).toBe("attachment");
    expect(sanitizeFilename("/")).toBe("attachment");
  });

  it("bounds the length", () => {
    expect(sanitizeFilename("x".repeat(500))).toHaveLength(180);
  });
});

describe("contentDisposition", () => {
  it("always marks the response as an attachment", () => {
    expect(contentDisposition("notes.txt")).toBe(
      `attachment; filename="notes.txt"; filename*=UTF-8''notes.txt`,
    );
  });

  it("escapes quotes that would break the header", () => {
    expect(contentDisposition('ev"il.txt')).toContain('filename="ev_il.txt"');
  });

  it("keeps non-ASCII names available through the encoded form", () => {
    const header = contentDisposition("répertoire.pdf");
    expect(header).toContain('filename="r_pertoire.pdf"');
    expect(header).toContain("filename*=UTF-8''r%C3%A9pertoire.pdf");
  });
});
