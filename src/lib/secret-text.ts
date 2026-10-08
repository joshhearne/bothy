/**
 * Character classes and the NATO readback for a revealed secret.
 *
 * Ported from AlphabetSoup (alphabetsoup.app, MIT, same author), whose tables
 * are kept identical across its web, desktop and extension builds so a
 * readback reads the same everywhere. Pure: no DOM, no React, so it can be
 * tested alone and never touches what it is given beyond splitting it.
 */

export type SecretKind = "letter" | "digit" | "symbol" | "other";

export type SecretToken = {
  /** The character as it appears in the secret. Never altered. */
  char: string;
  kind: SecretKind;
  /** What to say for it. Null for a character the tables do not know. */
  word: string | null;
};

export const NATO: Readonly<Record<string, string>> = {
  A: "Alpha", B: "Bravo", C: "Charlie", D: "Delta", E: "Echo",
  F: "Foxtrot", G: "Golf", H: "Hotel", I: "India", J: "Juliet",
  K: "Kilo", L: "Lima", M: "Mike", N: "November", O: "Oscar",
  P: "Papa", Q: "Quebec", R: "Romeo", S: "Sierra", T: "Tango",
  U: "Uniform", V: "Victor", W: "Whiskey", X: "X-ray", Y: "Yankee",
  Z: "Zulu",
};

export const NUMBER_WORDS: Readonly<Record<string, string>> = {
  "0": "Zero", "1": "One", "2": "Two", "3": "Three", "4": "Four",
  "5": "Five", "6": "Six", "7": "Seven", "8": "Eight", "9": "Nine",
};

export const SYMBOL_NAMES: Readonly<Record<string, string>> = {
  "-": "Dash", "_": "Underscore", ".": "Period", "/": "Slash",
  "\\": "Backslash", "@": "At", "#": "Pound", "$": "Dollar",
  "%": "Percent", "&": "Ampersand", "*": "Asterisk", "+": "Plus",
  "=": "Equals", "?": "Question", "!": "Exclamation", ":": "Colon",
  ";": "Semicolon", "(": "Open-Paren", ")": "Close-Paren",
  "[": "Open-Bracket", "]": "Close-Bracket", "<": "Less-Than",
  ">": "Greater-Than", ",": "Comma", "'": "Apostrophe", '"': "Quote",
  " ": "Space", "^": "Caret", "`": "Backtick", "~": "Tilde",
  "{": "Open-Brace", "}": "Close-Brace", "|": "Pipe",
  "‘": "Apostrophe", "’": "Apostrophe",
  "“": "Quote", "”": "Quote",
  "€": "Euro", "£": "Pound-Sterling", "¥": "Yen",
  "•": "Bullet",
};

/** One token per user-perceived character, so an emoji or a combined accent stays whole. */
export function parseSecret(text: string): SecretToken[] {
  return Array.from(text, (char) => {
    const upper = char.toUpperCase();
    if (NATO[upper]) return { char, kind: "letter", word: NATO[upper] };
    if (NUMBER_WORDS[char]) return { char, kind: "digit", word: NUMBER_WORDS[char] };
    if (SYMBOL_NAMES[char]) return { char, kind: "symbol", word: SYMBOL_NAMES[char] };
    // Outside the tables: a letter with an accent, a non-Latin script, an
    // emoji. Still classed so the colours stay honest about what it is.
    if (/\p{L}/u.test(char)) return { char, kind: "letter", word: null };
    if (/\p{N}/u.test(char)) return { char, kind: "digit", word: null };
    if (/[\p{P}\p{S}\p{Z}]/u.test(char)) return { char, kind: "symbol", word: null };
    return { char, kind: "other", word: null };
  });
}

/** True for a letter whose case the listener has to be told about. */
export function isCapital(token: SecretToken): boolean {
  return token.kind === "letter" && token.char !== token.char.toLowerCase();
}

export type ReadbackWords = {
  /** "as in", read between the character and its word. */
  asIn: string;
  /** "Capital", read before an upper-case letter. */
  capital: string;
};

/**
 * One line somebody can read down a phone: letters spelled with their case,
 * symbols named, digits left as they are because a digit is never misheard
 * for another. Joined with " | " exactly as AlphabetSoup's Copy Readback is.
 */
export function buildReadback(tokens: SecretToken[], words: ReadbackWords): string {
  return tokens.map((token) => readbackPart(token, words)).join(" | ");
}

export function readbackPart(token: SecretToken, words: ReadbackWords): string {
  if (token.word === null) return token.char;
  if (token.kind === "digit") return token.char;
  const shown = token.char === " " ? "·" : token.char;
  const lead = isCapital(token) ? `${words.capital} ${shown}` : shown;
  return `${lead} ${words.asIn} ${token.word}`;
}

// Excel, LibreOffice and Google Sheets treat a cell beginning with =, +, - or @
// as a formula, and a readback gets pasted into tickets and spreadsheets. A
// leading apostrophe makes the rest literal text and is not displayed.
const FORMULA_LEAD = /^[=+\-@\t\r]/;

export function clipboardSafe(text: string): string {
  return text
    .split("\n")
    .map((line) => (FORMULA_LEAD.test(line) ? `'${line}` : line))
    .join("\n");
}
