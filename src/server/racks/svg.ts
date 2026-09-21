import { readableOn, toRgb } from "@/lib/brand-color";

/**
 * A rack elevation as SVG: rails, numbered units, and a labelled block per
 * mounted thing. Vector so it prints at any size, and text rather than
 * artwork, because what a reader needs off a printed elevation is what is
 * where — not a picture of a switch.
 */

export type RackFace = "front" | "rear";

export type RackBlock = {
  positionU: number;
  heightU: number;
  label: string;
  typeName: string | null;
  color: string;
};

export type RackDrawing = {
  name: string;
  totalU: number;
  numbering: "bottom_up" | "top_down";
  face: RackFace;
  blocks: RackBlock[];
};

const UNIT_HEIGHT = 22;
const RAIL_WIDTH = 34;
const BODY_WIDTH = 420;
const PADDING = 14;
const TITLE_HEIGHT = 30;

/** Everything that reaches the SVG is somebody's typing, so none of it is trusted. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** A colour that did not parse is drawn grey rather than injected into the file. */
function safeColor(value: string): string {
  return toRgb(value) ? value : "#9ca3af";
}

/**
 * Where a unit sits on the page. Rails are numbered from the bottom in most
 * rooms and from the top in some, and the drawing follows the rack rather than
 * renumbering it: with `top_down`, unit 1 is drawn at the top.
 */
export function unitY(unit: number, totalU: number, numbering: "bottom_up" | "top_down"): number {
  const fromTop = numbering === "bottom_up" ? totalU - unit : unit - 1;
  return TITLE_HEIGHT + PADDING + fromTop * UNIT_HEIGHT;
}

export function drawingSize(totalU: number): { width: number; height: number } {
  return {
    width: RAIL_WIDTH * 2 + BODY_WIDTH + PADDING * 2,
    height: TITLE_HEIGHT + PADDING * 2 + totalU * UNIT_HEIGHT,
  };
}

export function renderRackSvg(drawing: RackDrawing): string {
  const { width, height } = drawingSize(drawing.totalU);
  const bodyX = PADDING + RAIL_WIDTH;

  const rows: string[] = [];
  for (let unit = 1; unit <= drawing.totalU; unit += 1) {
    const y = unitY(unit, drawing.totalU, drawing.numbering);
    rows.push(
      `<rect x="${bodyX}" y="${y}" width="${BODY_WIDTH}" height="${UNIT_HEIGHT}" fill="none" stroke="#d4d4d8" stroke-width="0.5"/>`,
      // The number is printed on both rails, as it is on a real rack.
      `<text x="${PADDING + RAIL_WIDTH / 2}" y="${y + UNIT_HEIGHT / 2 + 4}" text-anchor="middle" font-size="10" fill="#71717a">${unit}</text>`,
      `<text x="${bodyX + BODY_WIDTH + RAIL_WIDTH / 2}" y="${y + UNIT_HEIGHT / 2 + 4}" text-anchor="middle" font-size="10" fill="#71717a">${unit}</text>`,
    );
  }

  const blocks = drawing.blocks.map((block) => {
    const top = Math.min(block.positionU + block.heightU - 1, drawing.totalU);
    // A block spans upward from its lowest unit; which end is higher on the
    // page depends on the numbering, so take whichever y is smaller.
    const y = Math.min(
      unitY(block.positionU, drawing.totalU, drawing.numbering),
      unitY(top, drawing.totalU, drawing.numbering),
    );
    const blockHeight = block.heightU * UNIT_HEIGHT;
    const fill = safeColor(block.color);
    const rgb = toRgb(fill);
    const ink = rgb ? readableOn(rgb) : "#101317";

    const name = escapeXml(block.label);
    const type = block.typeName ? escapeXml(block.typeName) : "";
    const middle = y + blockHeight / 2;

    return [
      `<rect x="${bodyX + 2}" y="${y + 1}" width="${BODY_WIDTH - 4}" height="${blockHeight - 2}" rx="3" fill="${fill}" stroke="#18181b" stroke-width="0.5"/>`,
      `<text x="${bodyX + 12}" y="${middle + 4}" font-size="12" font-weight="600" fill="${ink}">${name}</text>`,
      type
        ? `<text x="${bodyX + BODY_WIDTH - 12}" y="${middle + 4}" text-anchor="end" font-size="10" fill="${ink}" opacity="0.85">${type}</text>`
        : "",
    ].join("");
  });

  const title = escapeXml(drawing.name);
  const faceLabel = drawing.face === "front" ? "Front" : "Rear";

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${title} ${faceLabel} elevation">`,
    `<rect width="${width}" height="${height}" fill="#ffffff"/>`,
    `<text x="${PADDING}" y="20" font-size="14" font-weight="600" fill="#18181b">${title} — ${faceLabel}</text>`,
    `<g font-family="ui-sans-serif, system-ui, sans-serif">`,
    rows.join(""),
    blocks.join(""),
    `</g>`,
    `</svg>`,
  ].join("");
}
