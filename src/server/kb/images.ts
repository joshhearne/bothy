/**
 * Pictures inside an article. An export names them the way its own site did —
 * `../images/Rear axle/seal 2.JPG` — which is a path beside the article, not
 * an address anything here answers on. These find those references and point
 * them at the pictures that came in with the import.
 *
 * Exports are written by looser tools than the renderer: a destination with a
 * space or a bracket in it is common and is not Markdown by the book, so the
 * references are read here rather than left to the parser.
 */

/** Answers the address of what is stored under a path, or null when nothing is. */
export type Resolver = (path: string) => string | null;

const MAX_LABEL = 1000;
const MAX_DESTINATION = 2000;

/**
 * The path a reference means inside the import, or null when it points
 * somewhere else: another site, an anchor, an address on this host, or out
 * above the top of the import.
 */
export function localPath(articlePath: string | null, destination: string): string | null {
  let target = destination.trim();
  if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1).trim();
  if (target === "" || target.startsWith("#") || target.startsWith("/")) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return null;

  target = target.replace(/[?#].*$/, "");
  try {
    target = decodeURIComponent(target);
  } catch {
    // A stray percent sign is part of the name.
  }
  if (target.includes("\0")) return null;

  const parts = articlePath ? articlePath.split("/").slice(0, -1) : [];
  for (const part of target.replace(/\\/g, "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.length === 0 ? null : parts.join("/");
}

/** Where fenced code begins and ends: what is inside is shown, not followed. */
function fences(markdown: string): [number, number][] {
  const ranges: [number, number][] = [];
  let open: { at: number; mark: string } | null = null;
  let at = 0;

  for (const line of markdown.split("\n")) {
    const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (match?.[1]) {
      const mark = match[1].charAt(0);
      if (!open) open = { at, mark };
      else if (open.mark === mark) {
        ranges.push([open.at, at + line.length]);
        open = null;
      }
    }
    at += line.length + 1;
  }
  if (open) ranges.push([open.at, markdown.length]);
  return ranges;
}

/** The index of the bracket that closes the one at `from`, or -1. */
function closing(text: string, from: number, opener: string, closer: string, limit: number): number {
  let depth = 0;
  const end = Math.min(text.length, from + limit);
  for (let at = from; at < end; at += 1) {
    const char = text[at];
    if (char === "\\") at += 1;
    else if (char === "\n" && (closer === ")" || text[at + 1] === "\n")) return -1;
    else if (char === opener) depth += 1;
    else if (char === closer) {
      depth -= 1;
      if (depth === 0) return at;
    }
  }
  return -1;
}

function splitTitle(inner: string): { destination: string; title: string | null } {
  const match = /^(.*?)\s+(?:"([^"]*)"|'([^']*)')\s*$/.exec(inner);
  if (!match) return { destination: inner.trim(), title: null };
  return { destination: (match[1] ?? "").trim(), title: match[2] ?? match[3] ?? "" };
}

function rewrite(text: string, articlePath: string | null, resolve: Resolver): string {
  let out = "";
  let at = 0;

  while (at < text.length) {
    const open = text.indexOf("[", at);
    if (open === -1) break;

    const labelEnd = closing(text, open, "[", "]", MAX_LABEL);
    if (labelEnd === -1 || text[labelEnd + 1] !== "(") {
      out += text.slice(at, open + 1);
      at = open + 1;
      continue;
    }
    const end = closing(text, labelEnd + 1, "(", ")", MAX_DESTINATION);
    if (end === -1) {
      out += text.slice(at, open + 1);
      at = open + 1;
      continue;
    }

    const image = open > 0 && text[open - 1] === "!" && text[open - 2] !== "\\";
    const start = image ? open - 1 : open;
    // A picture that is itself a link carries its own reference in the label.
    const label = rewrite(text.slice(open + 1, labelEnd), articlePath, resolve);
    const inner = text.slice(labelEnd + 2, end);
    const { destination, title } = splitTitle(inner);

    out += text.slice(at, start);
    at = end + 1;

    const path = localPath(articlePath, destination);
    const address = path === null ? null : resolve(path);

    if (address !== null) {
      const titled = title ? ` "${title.replace(/"/g, "&quot;")}"` : "";
      out += `${image ? "!" : ""}[${label}](${address}${titled})`;
    } else if (image && path !== null) {
      // A picture that did not come with the import: its caption is what is left.
      out += label;
    } else {
      out += `${image ? "!" : ""}[${label}](${inner})`;
    }
  }

  return out + text.slice(at);
}

/**
 * The article with every reference to something that was imported pointed at
 * where it is kept. References to anywhere else are left as they were.
 */
export function rewriteReferences(
  markdown: string,
  articlePath: string | null,
  resolve: Resolver,
): string {
  const skipped = fences(markdown);
  if (skipped.length === 0) return rewrite(markdown, articlePath, resolve);

  let out = "";
  let at = 0;
  for (const [from, to] of skipped) {
    out += rewrite(markdown.slice(at, from), articlePath, resolve);
    out += markdown.slice(from, to);
    at = to;
  }
  return out + rewrite(markdown.slice(at), articlePath, resolve);
}

/** Every path inside the import that the article refers to. */
export function referencedPaths(markdown: string, articlePath: string | null): string[] {
  const paths = new Set<string>();
  rewriteReferences(markdown, articlePath, (path) => {
    paths.add(path);
    return null;
  });
  return [...paths];
}
