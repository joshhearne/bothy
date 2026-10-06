/**
 * Hide rules as an administrator types them, made into what the database
 * matches. A rule is a literal phrase unless it says it is a regular
 * expression; several can be typed at once, one per line, and a literal
 * line can hold several split by tabs or commas. Matching is never
 * case-sensitive.
 *
 * Nothing here touches the database.
 */

export type HideScope = { matchArticles: boolean; matchCategories: boolean; matchFiles: boolean };

export type HideRuleInput = HideScope & { pattern: string; isRegex: boolean };

/** The characters a regular expression gives meaning to, made plain. */
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A file pattern as .gitignore has them: `*` is anything, `?` one character,
 * and the rest is literal. `*.pdf` matches a file name; `pdf` on its own is
 * read as a type, and matches a file of that type whatever it is called.
 */
export function globToRegex(glob: string): string {
  const body = glob
    .trim()
    .split(/(\*|\?)/)
    .map((part) => (part === "*" ? ".*" : part === "?" ? "." : escapeRegex(part)))
    .join("");
  return `^${body}$`;
}

/** Whether a literal file pattern names a type rather than a file: `pdf`, `.docx`. */
export function isTypePattern(pattern: string): boolean {
  return /^\.?[a-z0-9]{1,10}$/i.test(pattern.trim());
}

/** What is matched for a rule: the text regex, and the one for file names and types. */
export function compilePattern(pattern: string, isRegex: boolean): { regex: string; fileRegex: string } {
  const trimmed = pattern.trim();
  if (isRegex) return { regex: trimmed, fileRegex: trimmed };
  const regex = escapeRegex(trimmed);
  if (isTypePattern(trimmed)) {
    const type = escapeRegex(trimmed.replace(/^\./, ""));
    // The type itself, or a name ending in it.
    return { regex, fileRegex: `^(?:${type}|.*\\.${type})$` };
  }
  return { regex, fileRegex: globToRegex(trimmed) };
}

/**
 * The patterns typed into the box: one per line, and a literal line split
 * again on tabs and commas. A regular expression keeps its commas, since
 * `{2,3}` is one of them. Blank and repeated entries are dropped.
 */
export function splitPatterns(text: string, isRegex: boolean): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const pieces = isRegex ? line.split(/\t/) : line.split(/[\t,]/);
    for (const piece of pieces) {
      const pattern = piece.trim();
      if (pattern === "" || seen.has(pattern.toLowerCase())) continue;
      seen.add(pattern.toLowerCase());
      out.push(pattern);
    }
  }
  return out;
}
