/**
 * Text as a page wrote it, with the markup gone and the character references
 * read: named ones a page is likely to use, and any numbered one, decimal or
 * hex. A name's dash is a dash, not "&#8211;".
 */

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  laquo: "«",
  raquo: "»",
  lsaquo: "‹",
  rsaquo: "›",
  copy: "©",
  reg: "®",
  trade: "™",
  middot: "·",
  bull: "•",
  deg: "°",
};

/** Character references in a piece of text, read. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, reference: string) => {
    if (reference[0] === "#") {
      const code =
        reference[1]?.toLowerCase() === "x" ? parseInt(reference.slice(2), 16) : parseInt(reference.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      // Control characters and the surrogate range are not text.
      if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || (code >= 0xd800 && code <= 0xdfff)) return "";
      return String.fromCodePoint(code);
    }
    return NAMED[reference.toLowerCase()] ?? whole;
  });
}

/** The words in a piece of markup: tags gone, references read, spacing folded. */
export function textOf(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}
