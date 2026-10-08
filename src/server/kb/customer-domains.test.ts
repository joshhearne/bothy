import { describe, expect, it } from "vitest";
import { emailDomain, parseSignInDomains } from "./customer-domains";

describe("parseSignInDomains", () => {
  it("reads lines and commas, lowercases, strips a leading @, dedupes, and names what is not a domain", () => {
    expect(
      parseSignInDomains(
        " Example.com, @acme.test\nexample.com\nnot a domain!\n",
      ),
    ).toEqual({
      domains: ["example.com", "acme.test"],
      rejected: ["not", "a", "domain!"],
    });
  });

  it("gives nothing for nothing", () => {
    expect(parseSignInDomains("")).toEqual({ domains: [], rejected: [] });
  });
});

describe("emailDomain", () => {
  it("is the part after the last @, normalised", () => {
    expect(emailDomain("Jo.Bloggs@Example.COM")).toBe("example.com");
    expect(emailDomain("odd@name@sub.example.com")).toBe("sub.example.com");
  });

  it("is null for something that is not an address", () => {
    expect(emailDomain("nobody")).toBeNull();
    expect(emailDomain("@example.com")).toBeNull();
    expect(emailDomain("jo@")).toBeNull();
  });
});
