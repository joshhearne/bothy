import { describe, expect, it } from "vitest";
import { chunkText } from "./chunk";

const paragraph = (words: number, word = "packet") => Array(words).fill(word).join(" ");

describe("chunkText", () => {
  it("keeps a short article whole", () => {
    const chunks = chunkText("# Title\n\nOne paragraph.\n\nAnother.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ ordinal: 0, heading: "Title" });
    expect(chunks[0]?.content).toBe("One paragraph.\n\nAnother.");
  });

  it("returns nothing for an empty article", () => {
    expect(chunkText("\n\n  \n")).toEqual([]);
  });

  it("never exceeds the longest a piece may be", () => {
    const source = Array.from({ length: 40 }, () => paragraph(120)).join("\n\n");
    const chunks = chunkText(source, { target: 800, max: 1000 });
    expect(chunks.length).toBeGreaterThan(10);
    expect(Math.max(...chunks.map((chunk) => chunk.content.length))).toBeLessThanOrEqual(1000);
  });

  it("numbers pieces in order from zero", () => {
    const chunks = chunkText(Array.from({ length: 20 }, () => paragraph(100)).join("\n\n"), {
      target: 500,
      max: 800,
    });
    expect(chunks.map((chunk) => chunk.ordinal)).toEqual(chunks.map((_, index) => index));
  });

  it("starts a new piece at a heading once the last is long enough", () => {
    const source = `## Setup\n\n${paragraph(100)}\n\n## Printing\n\n${paragraph(100)}`;
    const chunks = chunkText(source, { target: 1600, max: 2400, min: 400 });
    expect(chunks.map((chunk) => chunk.heading)).toEqual(["Setup", "Printing"]);
  });

  it("records the headings a piece sits under, outermost first", () => {
    const source = `# Guide\n\n## Document attachments\n\n### Tunnel_Guide.pdf\n\n${paragraph(100)}`;
    expect(chunkText(source)[0]?.heading).toBe("Guide › Document attachments › Tunnel_Guide.pdf");
  });

  it("drops a deeper heading when a shallower one follows", () => {
    const source = `# A\n\n## B\n\n${paragraph(90)}\n\n# C\n\n${paragraph(90)}`;
    const chunks = chunkText(source, { min: 100 });
    expect(chunks.map((chunk) => chunk.heading)).toEqual(["A › B", "C"]);
  });

  it("splits the pages of text inside one fence", () => {
    const page = Array.from({ length: 30 }, () => paragraph(12, "firmware")).join("\n");
    const source = `## Document attachments\n\n\`\`\`text\n${Array(12).fill(page).join("\n")}\n\`\`\`\n`;
    const chunks = chunkText(source);

    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.every((chunk) => chunk.content.length <= 2400)).toBe(true);
    expect(chunks.every((chunk) => chunk.heading === "Document attachments")).toBe(true);
    expect(chunks.some((chunk) => chunk.content.includes("```"))).toBe(false);
  });

  it("does not read a heading inside a fence as a heading", () => {
    const chunks = chunkText("# Real\n\n```\n# not a heading\n```\n");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ heading: "Real", content: "# not a heading" });
  });

  it("cuts a single unbroken run that is longer than a piece", () => {
    const chunks = chunkText("x".repeat(5000), { target: 800, max: 1000 });
    expect(chunks).toHaveLength(5);
    expect(chunks.map((chunk) => chunk.content).join("")).toBe("x".repeat(5000));
  });

  it("loses no words", () => {
    const words = Array.from({ length: 3000 }, (_, index) => `w${index}`);
    const source = Array.from({ length: 60 }, (_, index) =>
      words.slice(index * 50, index * 50 + 50).join(" "),
    ).join("\n\n");
    const seen = chunkText(source, { target: 500, max: 700 })
      .map((chunk) => chunk.content)
      .join(" ")
      .split(/\s+/);
    expect(seen).toEqual(words);
  });
});
