import { describe, expect, it } from "vitest";
import { drawingSize, escapeXml, renderRackSvg, unitY, type RackDrawing } from "./svg";

function drawing(overrides: Partial<RackDrawing> = {}): RackDrawing {
  return {
    name: "Comms room rack",
    totalU: 12,
    numbering: "bottom_up",
    face: "front",
    blocks: [
      { positionU: 1, heightU: 2, label: "ups-01", typeName: "UPS", color: "#2563eb" },
      { positionU: 10, heightU: 1, label: "sw-core-01", typeName: "Switch", color: "#16a34a" },
    ],
    ...overrides,
  };
}

describe("escapeXml", () => {
  it("closes every hole a label could open", () => {
    expect(escapeXml('</text><script>alert(1)</script>')).toBe(
      "&lt;/text&gt;&lt;script&gt;alert(1)&lt;/script&gt;",
    );
    expect(escapeXml('a & b "quoted" \'single\'')).toBe(
      "a &amp; b &quot;quoted&quot; &apos;single&apos;",
    );
  });

  it("escapes the ampersand first, so nothing is double-escaped", () => {
    expect(escapeXml("&lt;")).toBe("&amp;lt;");
  });
});

describe("unitY", () => {
  it("puts unit 1 at the bottom when the rails are numbered that way", () => {
    const top = unitY(12, 12, "bottom_up");
    const bottom = unitY(1, 12, "bottom_up");
    expect(bottom).toBeGreaterThan(top);
  });

  it("puts unit 1 at the top when the rack is numbered that way", () => {
    const first = unitY(1, 12, "top_down");
    const last = unitY(12, 12, "top_down");
    expect(last).toBeGreaterThan(first);
  });

  it("is one unit apart between neighbours, whichever way round", () => {
    for (const numbering of ["bottom_up", "top_down"] as const) {
      const gap = Math.abs(unitY(5, 20, numbering) - unitY(6, 20, numbering));
      expect(gap).toBe(22);
    }
  });
});

describe("renderRackSvg", () => {
  it("draws one row per unit and numbers both rails", () => {
    const svg = renderRackSvg(drawing());
    // Twelve units, a number on each rail.
    expect(svg.match(/>12</g)?.length).toBe(2);
    expect(svg.match(/>1</g)?.length).toBe(2);
  });

  it("sizes itself to the rack", () => {
    expect(drawingSize(42).height).toBeGreaterThan(drawingSize(12).height);
    expect(renderRackSvg(drawing({ totalU: 42 }))).toContain(
      `height="${drawingSize(42).height}"`,
    );
  });

  it("names what is mounted, and what kind of thing it is", () => {
    const svg = renderRackSvg(drawing());
    expect(svg).toContain("sw-core-01");
    expect(svg).toContain("Switch");
    expect(svg).toContain("#16a34a");
  });

  it("gives a two-unit device twice the height of a one-unit device", () => {
    const svg = renderRackSvg(drawing());
    // 2U at 22px each, less the 2px inset.
    expect(svg).toContain('height="42"');
    expect(svg).toContain('height="20"');
  });

  it("never lets a label out unescaped", () => {
    const svg = renderRackSvg(
      drawing({
        name: '<script>alert("rack")</script>',
        blocks: [
          {
            positionU: 1,
            heightU: 1,
            label: '"/><script>alert(1)</script>',
            typeName: "<b>",
            color: "#2563eb",
          },
        ],
      }),
    );

    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).toContain("&lt;b&gt;");
  });

  it("draws an unparseable colour grey rather than writing it into the file", () => {
    const svg = renderRackSvg(
      drawing({
        blocks: [
          {
            positionU: 1,
            heightU: 1,
            label: "x",
            typeName: null,
            color: 'red" onload="alert(1)',
          },
        ],
      }),
    );

    expect(svg).not.toContain("onload");
    expect(svg).toContain("#9ca3af");
  });

  it("keeps a block inside the rack when it would run off the top", () => {
    const svg = renderRackSvg(
      drawing({ totalU: 4, blocks: [{ positionU: 4, heightU: 3, label: "tall", typeName: null, color: "#2563eb" }] }),
    );
    // It still draws, and its top edge is not above the first unit's row.
    expect(svg).toContain("tall");
    expect(svg).not.toContain('y="-');
  });

  it("says which face it is", () => {
    expect(renderRackSvg(drawing({ face: "rear" }))).toContain("Rear");
    expect(renderRackSvg(drawing())).toContain("Front");
  });
});
