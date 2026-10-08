import { describe, expect, it } from "vitest";
import { buildReadback, clipboardSafe, isCapital, parseSecret } from "./secret-text";

const words = { asIn: "as in", capital: "Capital" };

describe("parseSecret", () => {
  it("classes letters, digits and symbols", () => {
    expect(parseSecret("aB3!").map((t) => t.kind)).toEqual([
      "letter",
      "letter",
      "digit",
      "symbol",
    ]);
  });

  it("names them from the NATO, number and symbol tables", () => {
    expect(parseSecret("x7@").map((t) => t.word)).toEqual(["X-ray", "Seven", "At"]);
  });

  it("never changes the character itself", () => {
    const text = "Pa$$w0rd 'Q'";
    expect(parseSecret(text).map((t) => t.char).join("")).toBe(text);
  });

  it("keeps a space as a symbol named Space", () => {
    expect(parseSecret(" ")[0]).toEqual({ char: " ", kind: "symbol", word: "Space" });
  });

  it("classes an accented or non-Latin letter without naming it", () => {
    expect(parseSecret("é")[0]).toEqual({ char: "é", kind: "letter", word: null });
    expect(parseSecret("ж")[0]).toEqual({ char: "ж", kind: "letter", word: null });
  });

  it("keeps an emoji as one token", () => {
    const tokens = parseSecret("a🔑b");
    expect(tokens).toHaveLength(3);
    expect(tokens[1]).toEqual({ char: "🔑", kind: "symbol", word: null });
  });

  it("gives nothing for an empty string", () => {
    expect(parseSecret("")).toEqual([]);
  });
});

describe("isCapital", () => {
  it("is true only for an upper-case letter", () => {
    expect(parseSecret("Qq1").map(isCapital)).toEqual([true, false, false]);
  });
});

describe("buildReadback", () => {
  it("spells letters with their case, names symbols, leaves digits", () => {
    expect(buildReadback(parseSecret("Pa4!"), words)).toBe(
      "Capital P as in Papa | a as in Alpha | 4 | ! as in Exclamation",
    );
  });

  it("shows a space as a middle dot so it is not lost in the line", () => {
    expect(buildReadback(parseSecret(" "), words)).toBe("· as in Space");
  });

  it("reads an unknown character as itself", () => {
    expect(buildReadback(parseSecret("é"), words)).toBe("é");
  });
});

describe("clipboardSafe", () => {
  it("prefixes a line a spreadsheet would run as a formula", () => {
    expect(clipboardSafe("=cmd")).toBe("'=cmd");
    expect(clipboardSafe("+1 | a")).toBe("'+1 | a");
    expect(clipboardSafe("-")).toBe("'-");
    expect(clipboardSafe("@x")).toBe("'@x");
  });

  it("leaves an ordinary line alone", () => {
    expect(clipboardSafe("Capital P as in Papa")).toBe("Capital P as in Papa");
  });
});
