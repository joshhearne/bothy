/**
 * One-off: a Markdown field whose source was pasted into the visual editor
 * before it read pasted text as Markdown. Every marker got a backslash and
 * every line became its own paragraph. Undo both, and save through the
 * service so a revision and an audit entry are written.
 *
 *   npx tsx --conditions react-server scripts/unescape-markdown.ts <documentId> <fieldId> <actorId> [--write]
 *
 * Run from the checkout with DATABASE_URL set. Without --write it prints the
 * repaired source and changes nothing.
 */
import "dotenv/config";

const [documentId, fieldId, actorId] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const write = process.argv.includes("--write");
if (!documentId || !fieldId || !actorId) {
  console.error("usage: unescape-markdown.ts <documentId> <fieldId> <actorId> [--write]");
  process.exit(2);
}

export function repair(source: string): string {
  const lines = source
    .replace(/\r\n?/g, "\n")
    // A backslash before ASCII punctuation is an escape; the text wanted the mark.
    .replace(/\\([!-/:-@[-`{-~])/g, "$1")
    .split("\n");

  const isRow = (line: string | undefined) => !!line && /^\s*\|.*\|\s*$/.test(line);
  const isDelimiter = (line: string | undefined) =>
    !!line && /^\s*\|(\s*:?-+:?\s*\|)+\s*$/.test(line);
  const isItem = (line: string | undefined) => !!line && /^\s*([-*+]|\d+[.)])\s+\S/.test(line);

  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() !== "") {
      out.push(line);
      continue;
    }
    const prev = out[out.length - 1];
    const next = lines[i + 1];
    // The first line with text after the next one, however many blanks between.
    const after = lines.slice(i + 2).find((candidate) => candidate.trim() !== "");
    // A blank line between two rows of the same table was the editor's doing,
    // unless the row after it heads a new table (a delimiter row follows it).
    if (isRow(prev) && isRow(next) && !isDelimiter(after)) continue;
    // Likewise between two items of one list.
    if (isItem(prev) && isItem(next)) continue;
    out.push(line);
  }
  return out.join("\n");
}

const { db } = await import("../src/server/db");
const { documents } = await import("../src/server/db/schema");
const { eq } = await import("drizzle-orm");
const { saveDocument } = await import("../src/server/services/documents");
const { ALL_COMPANIES } = await import("../src/server/auth/company-scope");

const [row] = await db
  .select({ values: documents.fieldValues })
  .from(documents)
  .where(eq(documents.id, documentId));
if (!row) {
  console.error("no such document");
  process.exit(1);
}
const current = (row.values as Record<string, unknown>)[fieldId];
if (typeof current !== "string") {
  console.error("field is not text");
  process.exit(1);
}
const repaired = repair(current);
if (!write) {
  console.log(repaired);
  process.exit(0);
}
const result = await saveDocument(
  documentId,
  { values: { [fieldId]: repaired } },
  actorId,
  ALL_COMPANIES,
);
console.log(JSON.stringify({ ok: result.ok, errors: "errors" in result ? result.errors : undefined }));
process.exit(result.ok ? 0 : 1);
