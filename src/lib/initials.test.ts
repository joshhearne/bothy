import { describe, expect, it } from "vitest";
import { initialsFor } from "./initials";

describe("initialsFor", () => {
  it("takes the first letter of the first and last name", () => {
    expect(initialsFor("Josh Hearne", "josh@example.com")).toBe("JH");
  });

  it("skips the middle name", () => {
    expect(initialsFor("Ann Marie Smith", "ann@example.com")).toBe("AS");
  });

  it("uses one letter for a single name", () => {
    expect(initialsFor("Prince", "prince@example.com")).toBe("P");
  });

  it("splits names joined by punctuation", () => {
    expect(initialsFor("mary-jane watson", "mj@example.com")).toBe("MW");
  });

  it("falls back to the email when there is no name", () => {
    expect(initialsFor("", "rowan@example.com")).toBe("R");
    expect(initialsFor("   ", "rowan@example.com")).toBe("R");
  });

  it("skips punctuation at the start of an email", () => {
    expect(initialsFor("", "_svc@example.com")).toBe("S");
  });

  it("handles a name outside the Latin alphabet", () => {
    expect(initialsFor("Ада Лавлейс", "ada@example.com")).toBe("АЛ");
  });

  it("never returns an empty label", () => {
    expect(initialsFor("", "@")).toBe("?");
  });
});
