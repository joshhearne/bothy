import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, isTheme, THEMES } from "./theme";

describe("isTheme", () => {
  it("accepts every theme it ships", () => {
    for (const theme of THEMES) expect(isTheme(theme)).toBe(true);
  });

  it("refuses anything else, including a cookie someone hand-edited", () => {
    for (const value of ["Dark", "solarized", "", null, undefined, 1, {}]) {
      expect(isTheme(value)).toBe(false);
    }
  });

  it("defaults to following the system", () => {
    expect(DEFAULT_THEME).toBe("system");
  });
});
