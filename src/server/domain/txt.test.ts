import { describe, expect, it } from "vitest";
import { classifyTxt } from "./txt";

describe("classifyTxt", () => {
  it("names the mail policies", () => {
    expect(classifyTxt("v=spf1 include:_spf.google.com ~all")).toEqual({
      kind: "spf",
      label: "SPF",
    });
    expect(classifyTxt("v=DMARC1; p=reject; rua=mailto:d@example.com")).toEqual(
      { kind: "dmarc", label: "DMARC" },
    );
    expect(classifyTxt("v=DKIM1; k=rsa; p=MIIB...")).toEqual({
      kind: "dkim",
      label: "DKIM",
    });
  });

  it("names the verification tokens the user listed", () => {
    expect(classifyTxt("google-site-verification=abc123").label).toBe(
      "Google site verification",
    );
    expect(classifyTxt("atlassian-domain-verification=xyz").label).toBe(
      "Atlassian domain verification",
    );
    expect(classifyTxt("v=verifydomain MS=ms12345678").label).toBe(
      "Microsoft 365 verification",
    );
    expect(classifyTxt("MS=ms12345678").label).toBe(
      "Microsoft 365 verification",
    );
  });

  it("names other common tokens and falls back to a generic verification", () => {
    expect(classifyTxt("amazonses:abc=").label).toBe("Amazon SES verification");
    expect(classifyTxt("apple-domain-verification=abc").label).toBe(
      "Apple domain verification",
    );
    expect(classifyTxt("acme-widgets-domain-verification=abc")).toEqual({
      kind: "verification",
      label: "Domain verification",
    });
  });

  it("is case-insensitive and tolerates leading space", () => {
    expect(classifyTxt("  V=SPF1 -all").kind).toBe("spf");
  });

  it("leaves what it does not know alone", () => {
    expect(classifyTxt("some free text")).toEqual({
      kind: "other",
      label: null,
    });
    expect(classifyTxt("").kind).toBe("other");
  });
});
