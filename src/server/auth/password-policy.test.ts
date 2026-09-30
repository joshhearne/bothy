import { describe, expect, it } from "vitest";
import { checkPassword } from "./password-policy";

describe("checkPassword", () => {
  it("accepts a password that meets every rule", () => {
    expect(checkPassword("Correct horse 7!").ok).toBe(true);
  });

  it("names each rule that is not met", () => {
    expect(checkPassword("short1!").unmet).toEqual(["length", "upper"]);
    expect(checkPassword("alllowercase1!").unmet).toEqual(["upper"]);
    expect(checkPassword("ALLUPPERCASE1!").unmet).toEqual(["lower"]);
    expect(checkPassword("NoNumbersHere!").unmet).toEqual(["number"]);
    expect(checkPassword("NoSpecial123").unmet).toEqual(["special"]);
  });

  it("counts a space and any non-letter as the special character", () => {
    expect(checkPassword("Two words 12").ok).toBe(true);
    expect(checkPassword("Résumé·2024").ok).toBe(true);
  });

  it("allows what is long and refuses what is absurd", () => {
    expect(checkPassword(`Aa1! ${"x".repeat(60)}`).ok).toBe(true);
    expect(checkPassword(`Aa1! ${"x".repeat(130)}`).unmet).toEqual(["length"]);
  });

  it("refuses the person's own address or name, whatever the case", () => {
    const owner = { email: "Sam.Reader@example.com", name: "Sam Reader" };
    expect(checkPassword("Sam.Reader@example.com1!", owner).unmet).toEqual(["identity"]);
    expect(checkPassword("SAM.READER is here 1!", owner).unmet).toEqual(["identity"]);
    expect(checkPassword("Reader's choice 1!", owner).unmet).toEqual(["identity"]);
    expect(checkPassword("Unrelated words 1!", owner).ok).toBe(true);
  });

  it("does not treat a two-letter name as a forbidden word", () => {
    expect(checkPassword("Am I allowed 1!", { name: "Al Jo" }).ok).toBe(true);
  });
});
