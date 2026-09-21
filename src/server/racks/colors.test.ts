import { describe, expect, it } from "vitest";
import {
  colorDistance,
  colorWarnings,
  DEFAULT_PALETTE,
  fallbackColor,
  resolveColors,
  toOklab,
  tooClose,
  TOO_CLOSE,
} from "./colors";
import { toRgb } from "@/lib/brand-color";

describe("toOklab", () => {
  it("matches the reference values for the corners", () => {
    // Ottosson's own examples: white is L=1, black L=0, both neutral.
    const white = toOklab({ r: 255, g: 255, b: 255 });
    expect(white.L).toBeCloseTo(1, 3);
    expect(white.a).toBeCloseTo(0, 3);
    expect(white.b).toBeCloseTo(0, 3);

    const black = toOklab({ r: 0, g: 0, b: 0 });
    expect(black.L).toBeCloseTo(0, 3);

    // Pure red sits warm and red: positive a, positive b.
    const red = toOklab({ r: 255, g: 0, b: 0 });
    expect(red.L).toBeCloseTo(0.628, 2);
    expect(red.a).toBeGreaterThan(0.2);
    expect(red.b).toBeGreaterThan(0.1);
  });
});

describe("colorDistance", () => {
  it("is zero for the same colour and symmetric", () => {
    expect(colorDistance("#2563eb", "#2563eb")).toBeCloseTo(0, 6);
    expect(colorDistance("#2563eb", "#16a34a")).toBeCloseTo(
      colorDistance("#16a34a", "#2563eb") as number,
      6,
    );
  });

  it("is null when either colour is not a colour", () => {
    expect(colorDistance("#2563eb", "nonsense")).toBeNull();
    expect(colorDistance("", "#2563eb")).toBeNull();
  });

  it("puts black and white furthest apart", () => {
    const extremes = colorDistance("#000000", "#ffffff") as number;
    expect(extremes).toBeGreaterThan(colorDistance("#2563eb", "#16a34a") as number);
  });
});

describe("tooClose", () => {
  it("catches two blues nobody could tell apart on paper", () => {
    expect(tooClose("#2563eb", "#2f6ae8")).toBe(true);
    expect(tooClose("#2563eb", "#2563ec")).toBe(true);
  });

  it("leaves genuinely different colours alone", () => {
    expect(tooClose("#2563eb", "#16a34a")).toBe(false);
    expect(tooClose("#2563eb", "#ea580c")).toBe(false);
  });

  it("is the threshold the palette was built to clear", () => {
    for (let i = 0; i < DEFAULT_PALETTE.length; i += 1) {
      for (let j = i + 1; j < DEFAULT_PALETTE.length; j += 1) {
        const distance = colorDistance(
          DEFAULT_PALETTE[i] as string,
          DEFAULT_PALETTE[j] as string,
        ) as number;
        expect(distance, `${DEFAULT_PALETTE[i]} vs ${DEFAULT_PALETTE[j]}`).toBeGreaterThanOrEqual(
          TOO_CLOSE,
        );
      }
    }
  });
});

describe("fallbackColor", () => {
  it("walks the palette in order", () => {
    expect(fallbackColor("any", 0)).toBe(DEFAULT_PALETTE[0]);
    expect(fallbackColor("any", 3)).toBe(DEFAULT_PALETTE[3]);
  });

  it("stays put for the same type once the palette runs out", () => {
    const first = fallbackColor("doc-type-abc", 99);
    expect(fallbackColor("doc-type-abc", 99)).toBe(first);
    expect(toRgb(first)).not.toBeNull();
  });
});

describe("resolveColors", () => {
  const types = [
    { docTypeId: "switch", docTypeName: "Switch", global: "#2563eb", company: "#be123c" },
    { docTypeId: "server", docTypeName: "Server", global: "#16a34a" },
    { docTypeId: "patch", docTypeName: "Patch panel" },
  ];

  it("lets the client win, then the MSP, then the palette", () => {
    const [sw, server, patch] = resolveColors(types);

    expect(sw?.color).toBe("#be123c");
    expect(sw?.source).toBe("company");
    // The default is kept, so the screen can say what was overridden.
    expect(sw?.globalColor).toBe("#2563eb");

    expect(server?.color).toBe("#16a34a");
    expect(server?.source).toBe("global");

    expect(patch?.source).toBe("fallback");
    expect(patch?.color).toBe(DEFAULT_PALETTE[2]);
  });

  it("normalizes what it is given", () => {
    const [only] = resolveColors([{ docTypeId: "x", docTypeName: "X", company: "#ABC" }]);
    expect(only?.color).toBe("#aabbcc");
  });

  it("ignores a colour that is not one", () => {
    const [only] = resolveColors([
      { docTypeId: "x", docTypeName: "X", company: "red", global: "#16a34a" },
    ]);
    expect(only?.color).toBe("#16a34a");
    expect(only?.source).toBe("global");
  });
});

describe("colorWarnings", () => {
  it("says nothing about a rack of distinct colours", () => {
    expect(
      colorWarnings(
        resolveColors([
          { docTypeId: "a", docTypeName: "Switch", global: "#2563eb" },
          { docTypeId: "b", docTypeName: "Server", global: "#16a34a" },
        ]),
      ),
    ).toEqual([]);
  });

  it("names both types when two colours are too close", () => {
    const warnings = colorWarnings(
      resolveColors([
        { docTypeId: "a", docTypeName: "Switch", global: "#2563eb" },
        { docTypeId: "b", docTypeName: "Router", global: "#2f6ae8" },
      ]),
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.kind).toBe("too_close");
    expect(warnings[0]).toMatchObject({ types: ["Switch", "Router"] });
  });

  it("says so when a client override lands on a colour already in use", () => {
    // The client set Server to the blue the MSP uses for switches.
    const warnings = colorWarnings(
      resolveColors([
        { docTypeId: "a", docTypeName: "Switch", global: "#2563eb" },
        { docTypeId: "b", docTypeName: "Server", global: "#16a34a", company: "#2563eb" },
      ]),
    );

    expect(warnings.map((warning) => warning.kind)).toContain("override_shadows_global");
    const collision = warnings.find((warning) => warning.kind === "override_shadows_global");
    expect(collision).toMatchObject({ type: "Server", collidesWith: "Switch" });
  });

  it("does not blame an override when neither colour is one", () => {
    const warnings = colorWarnings(
      resolveColors([
        { docTypeId: "a", docTypeName: "Switch", global: "#2563eb" },
        { docTypeId: "b", docTypeName: "Router", global: "#2563eb" },
      ]),
    );
    expect(warnings.every((warning) => warning.kind === "too_close")).toBe(true);
  });
});
