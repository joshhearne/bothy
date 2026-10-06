/**
 * A runbook is an article whose body is a procedure: the items of its
 * top-level lists are the steps, each with a stable id so a system
 * that tracks progress through them can key on it across edits. The steps
 * are derived from the body on every save and never authored apart from it.
 *
 * Pure: no database, no server-only imports, so the editor can show the same
 * steps a save would store.
 */

export type RunbookStep = {
  /** `[a-z0-9-]{1,40}`, from an `{#id}` block at the end of the item or minted on save. */
  id: string;
  /** The item's first line, Markdown, without its id block. */
  text: string;
  /** Whatever is nested under the item, Markdown, when there is any. */
  note?: string;
  /** The name in the first `@canned:[Name]` token of the text, for a reply template. */
  canned?: string;
};

/** The body in order: prose, then a run of steps, then prose again, as many times as it goes. */
export type RunbookSegment =
  | { kind: "markdown"; text: string }
  | { kind: "steps"; /** Indexes into `steps`, first and one past the last. */ from: number; to: number };

export type RunbookParts = {
  /** The body with every step carrying its id. */
  body: string;
  steps: RunbookStep[];
  segments: RunbookSegment[];
};

/** A body whose steps cannot be told apart: the same id on two of them. */
export class RunbookStepError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunbookStepError";
  }
}

export const STEP_ID = /^[a-z0-9-]{1,40}$/;
const ID_BLOCK = /\s*\{#([^}\s]+)\}\s*$/;
const ORDERED = /^(\d+)[.)]\s+(.*)$/;
const TASK = /^[-*+]\s+\[[ xX]\]\s+(.*)$/;
const CANNED = /@canned:\[([^\]]+)\]/;

function fenced(lines: string[]): boolean[] {
  const inside: boolean[] = [];
  let open: string | null = null;
  for (const line of lines) {
    const mark = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1]?.charAt(0) ?? null;
    if (mark && !open) open = mark;
    else if (mark && mark === open) {
      inside.push(true);
      open = null;
      continue;
    }
    inside.push(open !== null);
  }
  return inside;
}

function mintId(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Words only, lower case: what two edits of the same step still share. */
function keyOf(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

type Item = { line: number; text: string; id: string | null; noteLines: string[]; end: number };
type ListRun = { items: Item[]; start: number; end: number };

const BULLET = /^[-*+]\s+(?!\[[ xX]\]\s)(.*)$/;

/**
 * Every top-level list that is a procedure: an ordered list, a task list,
 * or a bullet list whose items carry step ids. A bullet list without ids is
 * prose. Lists are read in the order they come, across headings, so a
 * runbook can be written in sections.
 */
function findLists(lines: string[]): ListRun[] {
  const inside = fenced(lines);
  const runs: ListRun[] = [];
  let at = 0;
  while (at < lines.length) {
    const line = lines[at] ?? "";
    const marker = inside[at]
      ? null
      : ORDERED.test(line)
        ? ORDERED
        : TASK.test(line)
          ? TASK
          : BULLET.test(line)
            ? BULLET
            : null;
    if (!marker) {
      at += 1;
      continue;
    }
    const items: Item[] = [];
    const start = at;
    while (at < lines.length) {
      const current = lines[at] ?? "";
      const match = inside[at] ? null : marker.exec(current);
      if (!match) break;
      const raw = (marker === ORDERED ? match[2] : match[1]) ?? "";
      const idMatch = ID_BLOCK.exec(raw);
      const item: Item = {
        line: at,
        text: (idMatch ? raw.slice(0, idMatch.index) : raw).trim(),
        id: idMatch?.[1] ?? null,
        noteLines: [],
        end: at,
      };
      at += 1;
      // Nested content: indented lines, and the blank lines between them.
      let pendingBlank: string[] = [];
      while (at < lines.length) {
        const next = lines[at] ?? "";
        if (next.trim() === "") {
          pendingBlank.push(next);
          at += 1;
          continue;
        }
        const indented = /^\s{2,}/.test(next) || inside[at];
        if (!indented) break;
        item.noteLines.push(...pendingBlank, next);
        pendingBlank = [];
        at += 1;
      }
      // Blank lines after the last nested line belong to nobody.
      at -= pendingBlank.length;
      item.end = at;
      items.push(item);
      // The list goes on across blank lines when another item follows them.
      let peek = at;
      while (peek < lines.length && (lines[peek] ?? "").trim() === "") peek += 1;
      if (peek < lines.length && !inside[peek] && marker.test(lines[peek] ?? "")) at = peek;
    }
    const procedure = marker !== BULLET || items.some((item) => item.id !== null);
    if (procedure && items.length > 0) runs.push({ items, start, end: items[items.length - 1]?.end ?? start });
  }
  return runs;
}

/** The common indent of a note, taken off every line. */
function dedent(lines: string[]): string {
  const indents = lines.filter((line) => line.trim() !== "").map((line) => /^\s*/.exec(line)?.[0].length ?? 0);
  const least = indents.length > 0 ? Math.min(...indents) : 0;
  return lines.map((line) => line.slice(Math.min(least, /^\s*/.exec(line)?.[0].length ?? 0))).join("\n").trim();
}

/**
 * The steps of a body, and the body with every step given its id. An item
 * without an id takes the id of the earlier step with the same words, when
 * `previous` has one, so an edit that only moves or rewords a little keeps
 * the id a consumer tracks progress by; otherwise it is minted. The body
 * comes back in segments, prose and steps by turns, for drawing.
 */
export function deriveRunbook(body: string, previous: readonly RunbookStep[] = []): RunbookParts {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const runs = findLists(lines);
  if (runs.length === 0) {
    const text = lines.join("\n");
    return { body: text, steps: [], segments: text.trim() === "" ? [] : [{ kind: "markdown", text: text.trim() }] };
  }

  const seen = new Set<string>();
  const byText = new Map<string, string>();
  for (const step of previous) if (!byText.has(keyOf(step.text))) byText.set(keyOf(step.text), step.id);

  const steps: RunbookStep[] = [];
  const segments: RunbookSegment[] = [];
  let cursor = 0;
  for (const run of runs) {
    const before = lines.slice(cursor, run.start).join("\n").trim();
    if (before !== "") segments.push({ kind: "markdown", text: before });
    const from = steps.length;
    for (const item of run.items) {
      let id = item.id;
      if (id !== null && !STEP_ID.test(id)) {
        throw new RunbookStepError(`Step id "${id}" must be 1 to 40 lowercase letters, digits, or dashes`);
      }
      if (id === null) {
        const kept = byText.get(keyOf(item.text));
        id = kept && !seen.has(kept) ? kept : mintId();
        while (seen.has(id)) id = mintId();
        const line = lines[item.line] ?? "";
        lines[item.line] = `${line.replace(/\s+$/, "")} {#${id}}`;
      }
      if (seen.has(id)) throw new RunbookStepError(`Step id "${id}" is used more than once`);
      seen.add(id);

      const step: RunbookStep = { id, text: item.text };
      const note = dedent(item.noteLines);
      if (note !== "") step.note = note;
      const canned = CANNED.exec(item.text)?.[1]?.trim();
      if (canned) step.canned = canned;
      steps.push(step);
    }
    segments.push({ kind: "steps", from, to: steps.length });
    cursor = run.end;
  }
  const after = lines.slice(cursor).join("\n").trim();
  if (after !== "") segments.push({ kind: "markdown", text: after });

  return { body: lines.join("\n"), steps, segments };
}

/** The body with the id blocks taken off, for anyone reading it as prose. */
export function withoutStepIds(body: string): string {
  return body.replace(/[ \t]*\{#[a-z0-9-]{1,40}\}[ \t]*$/gm, "");
}
