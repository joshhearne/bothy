/**
 * Imported Markdown, made to read as the source did. Converters are literal:
 * a site's numbered section titles arrive as empty list items with the title
 * in the paragraph below, a screenshot the crawl did not fetch arrives as an
 * empty link that cuts a list of steps in two, and a site's own "menu" of
 * anchor links arrives as a list pointing at anchors that no longer exist.
 * None of that is what the article says; it is how the page was built.
 *
 * Applied when an imported article is drawn, never to what was written here.
 */

const MENU_LABELS = /^(?:\*\*|__)?\s*(?:menu|contents|table of contents|in this article|on this page|jump to|quick links|navigation)\s*:?\s*(?:\*\*|__)?\s*$/i;
const ORDERED = /^(\s*)(\d+)([.)])\s+(.*)$/;
const EMPTY_ORDERED = /^(\s*)(\d+)[.)]\s*$/;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const ANCHOR_ONLY = /^\s*[-*+]\s+\[[^\]]*\]\(#[^)]*\)\s*$|^\s*\d+[.)]\s+\[[^\]]*\]\(#[^)]*\)\s*$/;
const EMPTY_LINK = /^\s*\[\s*\]\([^)]*\)\s*$/;
/** A picture that links to nowhere on the page: a print or share button. */
const BUTTON_LINK = /^\s*\[!\[[^\]]*\]\([^)]*\)\]\(#[^)]*\)\s*$/;
const IMAGE_LINE = /^\s*(?:\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)|!\[[^\]]*\]\([^)]*\))\s*$/;
const HEADING = /^\s{0,3}#{1,6}\s/;
/** A line that reads as a title: short, not a sentence, not starting mid-word. */
const TITLE_LIKE = /^(?!\s)(?![a-z])[^\n]{1,90}[^.!?:;,\s]$/;

/** A fenced block is shown as it is; nothing here looks inside one. */
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

/** Lists made only of links to anchors on the page, and a "MENU" line, with or without one under it. */
function dropAnchorMenus(lines: string[], inside: boolean[]): string[] {
  const keep = lines.map((line, i) => inside[i] || !MENU_LABELS.test(line));
  let at = 0;
  while (at < lines.length) {
    if (inside[at] || !ANCHOR_ONLY.test(lines[at] ?? "")) {
      at += 1;
      continue;
    }
    let end = at;
    while (end < lines.length && (ANCHOR_ONLY.test(lines[end] ?? "") || lines[end]?.trim() === "")) end += 1;
    // Only a run that is all anchors, at least two of them.
    const items = lines.slice(at, end).filter((line) => ANCHOR_ONLY.test(line));
    if (items.length >= 2) {
      for (let i = at; i < end; i += 1) keep[i] = false;
    }
    at = Math.max(end, at + 1);
  }
  return lines.filter((_, i) => keep[i]);
}

/** A link with nothing to click: a picture the import did not bring, or a button. */
function dropEmptyLinks(lines: string[], inside: boolean[]): string[] {
  return lines.filter((line, i) => inside[i] || (!EMPTY_LINK.test(line) && !BUTTON_LINK.test(line)));
}

/**
 * `1.` on a line of its own with a short line below is a numbered section
 * title whose number and text the converter kept apart. Joined, as a heading,
 * so it reads and outlines as the source did.
 */
function numberedTitles(lines: string[], inside: boolean[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const empty = inside[i] ? null : EMPTY_ORDERED.exec(line);
    if (empty && (empty[1] ?? "") === "") {
      let next = i + 1;
      while (next < lines.length && lines[next]?.trim() === "") next += 1;
      const title = lines[next]?.trim() ?? "";
      const after = lines[next + 1]?.trim() ?? "";
      if (IMAGE_LINE.test(title)) {
        // A step that is only a picture.
        out.push(`${empty[2]}. ${title}`);
        i = next;
        continue;
      }
      const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(title);
      if (heading) {
        // The number belongs to the heading under it.
        out.push(`${heading[1]} ${empty[2]}. ${heading[2]}`);
        i = next;
        continue;
      }
      if (
        title !== "" &&
        title.length <= 90 &&
        /[A-Za-z]/.test(title) &&
        !/^[!\[]/.test(title) &&
        !HEADING.test(title) &&
        !ORDERED.test(title) &&
        !BULLET.test(title) &&
        !/[.:;]$/.test(title) &&
        after === ""
      ) {
        out.push(`## ${empty[2]}. ${title}`);
        i = next;
        continue;
      }
    }
    out.push(line);
  }
  return out;
}

/**
 * Steps cut in two by a picture. A list that starts again at 1 right after
 * another list at the same depth, with nothing between them but pictures,
 * blank lines, and what is indented under the step above, is the same list:
 * the pictures move under the step above them, where the source had them,
 * and the count carries on through the rest of the list.
 *
 * A paragraph between two lists ends the first; the source meant two lists.
 * A line that runs on from the step above keeps the list going, as Markdown
 * reads it, so there is nothing to join; but when that line reads as a
 * title and a new list starts under it, as a PDF's text has them, a blank
 * line is put before it so the list really does start over.
 */
function joinSplitLists(lines: string[], inside: boolean[]): string[] {
  const out: string[] = [];
  let lastIndent: number | null = null;
  let lastNumber = 0;
  let lastMarker = ".";
  /** How far each depth's numbers have been moved on by a join. */
  const offsets = new Map<number, number>();
  let sinceItem: string[] = [];
  let blankSeen = false;
  let continued = false;

  const flush = () => {
    out.push(...sinceItem);
    sinceItem = [];
    blankSeen = false;
    continued = false;
  };
  const endList = () => {
    flush();
    lastIndent = null;
    lastNumber = 0;
    offsets.clear();
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const item = inside[i] ? null : ORDERED.exec(line);

    if (item) {
      const indent = (item[1] ?? "").length;
      const number = Number(item[2]);
      const marker = item[3] ?? ".";
      const text = item[4] ?? "";

      if (lastIndent !== null && number === 1 && continued) {
        const lastLine = [...sinceItem].reverse().find((between) => between.trim() !== "")?.trim() ?? "";
        if (TITLE_LIKE.test(lastLine) && !IMAGE_LINE.test(lastLine)) {
          const at = sinceItem.lastIndexOf(sinceItem.find((between) => between.trim() === lastLine) ?? "");
          if (at >= 0 && (at === 0 || sinceItem[at - 1]?.trim() !== "")) sinceItem.splice(at, 0, "");
          endList();
          out.push(line);
          lastIndent = indent;
          lastNumber = number;
          lastMarker = marker;
          continue;
        }
      }
      if (lastIndent !== null && indent === lastIndent && number === 1 && lastNumber >= 1 && marker === lastMarker && !continued) {
        // Tuck the pictures between under the item above, and carry the count on.
        for (const between of sinceItem) {
          out.push(between.trim() === "" ? "" : `${" ".repeat(indent + 4)}${between.trim()}`);
        }
        sinceItem = [];
        blankSeen = false;
        offsets.set(indent, lastNumber);
        lastNumber += 1;
        out.push(`${item[1] ?? ""}${lastNumber}${marker} ${text}`);
        continue;
      }
      flush();
      if (lastIndent !== null && indent < lastIndent) {
        // Back out of a nested list: its offset no longer applies.
        for (const depth of [...offsets.keys()]) if (depth > indent) offsets.delete(depth);
      }
      if (marker !== lastMarker) offsets.clear();
      const offset = offsets.get(indent) ?? 0;
      lastIndent = indent;
      lastNumber = number + offset;
      lastMarker = marker;
      out.push(offset === 0 ? line : `${item[1] ?? ""}${lastNumber}${marker} ${text}`);
      continue;
    }

    if (lastIndent === null) {
      out.push(line);
      continue;
    }

    const trimmed = line.trim();
    const deeper = line.length - line.trimStart().length > lastIndent;
    if (trimmed === "") {
      blankSeen = true;
      sinceItem.push(line);
      continue;
    }
    if (deeper || IMAGE_LINE.test(trimmed)) {
      sinceItem.push(line);
      continue;
    }
    if (!blankSeen) {
      // Runs on from the step above; the list goes on.
      continued = true;
      sinceItem.push(line);
      continue;
    }
    // A paragraph of its own: the list is over.
    endList();
    out.push(line);
  }
  flush();
  return out;
}

/** Markdown as imported, made to read as its source did. */
export function tidyImportedMarkdown(markdown: string): string {
  let lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  lines = dropAnchorMenus(lines, fenced(lines));
  lines = dropEmptyLinks(lines, fenced(lines));
  lines = numberedTitles(lines, fenced(lines));
  lines = joinSplitLists(lines, fenced(lines));
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
