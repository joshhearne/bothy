import { describe, expect, it } from "vitest";
import { namesAgree, squashName } from "./names";

describe("namesAgree", () => {
  it("reads a registry's legal name as the dropdown's short one", () => {
    expect(namesAgree("Cloudflare, Inc.", "Cloudflare")).toBe(true);
    expect(namesAgree("GoDaddy.com, LLC", "GoDaddy")).toBe(true);
    expect(namesAgree("Go Daddy, Inc.", "GoDaddy")).toBe(true);
    expect(namesAgree("NameCheap, Inc.", "Namecheap")).toBe(true);
  });

  it("does not confuse different registrars", () => {
    expect(namesAgree("Cloudflare, Inc.", "GoDaddy")).toBe(false);
    expect(namesAgree("Name.com, Inc.", "Namecheap")).toBe(false);
  });

  it("never matches on nothing", () => {
    expect(namesAgree("", "GoDaddy")).toBe(false);
    expect(namesAgree(", Inc.", "GoDaddy")).toBe(false);
  });

  it("squashes to letters and digits", () => {
    expect(squashName("Route 53 (AWS)")).toBe("route53aws");
  });
});
