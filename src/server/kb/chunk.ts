/**
 * Cuts an article into pieces small enough to rank and to quote. A piece
 * follows the article's own shape where it can — headings, then paragraphs —
 * and only cuts through a paragraph when one is longer than a piece may be,
 * which is what the text of an attached PDF usually is.
 */

export type Chunk = { ordinal: number; heading: string; content: string };

export type ChunkOptions = {
  /** Where a piece stops taking on more paragraphs. */
  target?: number;
  /** The longest a piece may be. */
  max?: number;
  /** Below this, a new heading does not start a new piece. */
  min?: number;
};

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;

type Block = { heading: string; text: string; startsSection: boolean };

/** Splits one over-long block on lines, then on sentences, then anywhere. */
function splitLong(text: string, max: number): string[] {
  if (text.length <= max) return [text];

  const pieces: string[] = [];
  let current = "";

  const push = (part: string, joiner: string) => {
    if (part.length > max) {
      if (current !== "") {
        pieces.push(current);
        current = "";
      }
      const sentences = part.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) ?? [part];
      if (sentences.length > 1) {
        for (const sentence of sentences) push(sentence.trimEnd(), " ");
        return;
      }
      for (let at = 0; at < part.length; at += max) pieces.push(part.slice(at, at + max));
      return;
    }

    if (current === "") current = part;
    else if (current.length + joiner.length + part.length <= max) current += joiner + part;
    else {
      pieces.push(current);
      current = part;
    }
  };

  for (const line of text.split("\n")) {
    if (line.trim() !== "") push(line, "\n");
  }
  if (current !== "") pieces.push(current);
  return pieces;
}

function toBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  const path: string[] = [];
  let lines: string[] = [];
  let fence: string | null = null;
  let startsSection = false;

  const flush = () => {
    const text = lines.join("\n").trim();
    lines = [];
    if (text === "") return;
    blocks.push({ heading: path.filter(Boolean).join(" › "), text, startsSection });
    startsSection = false;
  };

  for (const line of source.replace(/\r\n?/g, "\n").split("\n")) {
    const fenced = FENCE.exec(line);
    if (fence) {
      // Inside a fence a blank line still separates paragraphs: extracted PDF
      // text arrives as one fence many pages long.
      if (fenced && line.trim().startsWith(fence) && line.trim().replace(/[`~]/g, "") === "") {
        fence = null;
        flush();
      } else if (line.trim() === "") flush();
      else lines.push(line);
      continue;
    }

    if (fenced) {
      flush();
      fence = (fenced[1] as string).slice(0, 3);
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      const depth = (heading[1] as string).length;
      path.length = depth - 1;
      for (let i = 0; i < depth - 1; i += 1) path[i] ??= "";
      path[depth - 1] = (heading[2] as string).trim();
      startsSection = true;
      continue;
    }

    if (line.trim() === "") flush();
    else lines.push(line);
  }
  flush();

  return blocks;
}

export function chunkText(source: string, options: ChunkOptions = {}): Chunk[] {
  const target = options.target ?? 1600;
  const max = Math.max(options.max ?? 2400, target);
  const min = Math.min(options.min ?? 400, target);

  const chunks: Chunk[] = [];
  let heading = "";
  let content = "";

  const flush = () => {
    if (content.trim() !== "") {
      chunks.push({ ordinal: chunks.length, heading, content: content.trim() });
    }
    content = "";
  };

  for (const block of toBlocks(source)) {
    for (const [index, piece] of splitLong(block.text, max).entries()) {
      const newSection = index === 0 && block.startsSection && content.length >= min;
      const tooLong = content !== "" && content.length + 2 + piece.length > target;
      if (newSection || tooLong) flush();

      if (content === "") {
        heading = block.heading;
        content = piece;
      } else {
        content += `\n\n${piece}`;
      }
    }
  }
  flush();

  return chunks;
}
