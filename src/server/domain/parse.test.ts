import { describe, expect, it } from "vitest";
import {
  certificateFindings,
  dmarcPolicy,
  emailFindings,
  findDmarc,
  findSpf,
  joinTxt,
  nameMatches,
  parseCertificateDate,
  parseRdap,
  parseSubjectAltNames,
  registrationFindings,
  type CertificateSummary,
} from "./parse";

const NOW = new Date("2026-09-20T00:00:00Z");

function cert(overrides: Partial<CertificateSummary> = {}): CertificateSummary {
  return {
    issuer: "Google Trust Services",
    subject: "example.com",
    names: ["example.com"],
    validFrom: "2026-08-01T00:00:00.000Z",
    validTo: "2026-11-14T00:00:00.000Z",
    daysRemaining: 55,
    chainTrusted: true,
    chainError: null,
    coversDomain: true,
    ...overrides,
  };
}

describe("certificate reading", () => {
  it("parses the date format a socket reports", () => {
    expect(parseCertificateDate("Nov 14 12:00:00 2026 GMT")?.toISOString()).toBe(
      "2026-11-14T12:00:00.000Z",
    );
    expect(parseCertificateDate(undefined)).toBeNull();
    expect(parseCertificateDate("not a date")).toBeNull();
  });

  it("pulls the names out of a SAN list", () => {
    expect(parseSubjectAltNames("DNS:example.com, DNS:*.example.com")).toEqual([
      "example.com",
      "*.example.com",
    ]);
    expect(parseSubjectAltNames("IP Address:1.2.3.4")).toEqual([]);
    expect(parseSubjectAltNames(undefined)).toEqual([]);
  });

  it("matches a wildcard across one label and no further", () => {
    expect(nameMatches("example.com", "example.com")).toBe(true);
    expect(nameMatches("EXAMPLE.com", "example.com")).toBe(true);
    expect(nameMatches("www.example.com", "*.example.com")).toBe(true);
    // A wildcard does not cover the apex, nor two levels down.
    expect(nameMatches("example.com", "*.example.com")).toBe(false);
    expect(nameMatches("a.b.example.com", "*.example.com")).toBe(false);
    expect(nameMatches("example.com.evil.test", "*.example.com")).toBe(false);
  });
});

describe("certificateFindings", () => {
  it("is quiet when everything is in order", () => {
    expect(certificateFindings(cert()).every((f) => f.severity === "ok")).toBe(true);
  });

  it("warns as expiry approaches and fails once past", () => {
    expect(certificateFindings(cert({ daysRemaining: 12 }))[0]?.severity).toBe("warn");
    expect(certificateFindings(cert({ daysRemaining: -3 }))[0]?.severity).toBe("bad");
    expect(certificateFindings(cert({ daysRemaining: -3 }))[0]?.message).toContain("3 days ago");
  });

  it("calls out a chain that does not verify, and a name it does not cover", () => {
    const untrusted = certificateFindings(cert({ chainTrusted: false, chainError: "self signed" }));
    expect(untrusted[0]?.severity).toBe("bad");
    expect(untrusted[0]?.message).toContain("self signed");

    expect(certificateFindings(cert({ coversDomain: false }))[0]?.severity).toBe("bad");
  });
});

describe("parseRdap", () => {
  const body = {
    status: ["client transfer prohibited", "server delete prohibited"],
    events: [
      { eventAction: "registration", eventDate: "2015-03-08T10:00:00Z" },
      { eventAction: "expiration", eventDate: "2027-03-08T10:00:00Z" },
      { eventAction: "last changed", eventDate: "2026-01-02T10:00:00Z" },
    ],
    entities: [
      { roles: ["registrant"], vcardArray: ["vcard", [["fn", {}, "text", "Redacted"]]] },
      { roles: ["registrar"], vcardArray: ["vcard", [["version", {}, "text", "4.0"], ["fn", {}, "text", "GoDaddy.com, LLC"]]] },
    ],
  };

  it("reads the registrar, the dates, and the lock", () => {
    const record = parseRdap(body, NOW);
    expect(record.registrar).toBe("GoDaddy.com, LLC");
    expect(record.registered).toBe("2015-03-08T10:00:00.000Z");
    expect(record.expires).toBe("2027-03-08T10:00:00.000Z");
    expect(record.daysRemaining).toBe(169);
    expect(record.locked).toBe(true);
  });

  it("survives a response that is missing everything", () => {
    for (const input of [null, undefined, {}, { events: "no", entities: 5, status: {} }]) {
      const record = parseRdap(input, NOW);
      expect(record.registrar).toBeNull();
      expect(record.expires).toBeNull();
      expect(record.locked).toBe(false);
    }
  });

  it("ignores an event date that is not a date", () => {
    expect(parseRdap({ events: [{ eventAction: "expiration", eventDate: "soon" }] }, NOW).expires).toBeNull();
  });
});

describe("registrationFindings", () => {
  const base = { registrar: "GoDaddy", registered: null, expires: "x", statuses: ["ok"], locked: true };

  it("warns inside the renewal window", () => {
    expect(registrationFindings({ ...base, daysRemaining: 20 })[0]?.severity).toBe("warn");
    expect(registrationFindings({ ...base, daysRemaining: 200 })[0]?.severity).toBe("ok");
    expect(registrationFindings({ ...base, daysRemaining: -1 })[0]?.severity).toBe("bad");
  });

  it("mentions a missing transfer lock", () => {
    const findings = registrationFindings({ ...base, daysRemaining: 200, locked: false });
    expect(findings.some((f) => f.message.includes("transfer lock"))).toBe(true);
  });
});

describe("email posture", () => {
  it("joins the chunks a long TXT record arrives in", () => {
    expect(joinTxt(["v=spf1 ", "include:_spf.google.com ~all"])).toBe(
      "v=spf1 include:_spf.google.com ~all",
    );
    expect(joinTxt("v=spf1 -all")).toBe("v=spf1 -all");
  });

  it("finds SPF and DMARC among unrelated records", () => {
    const records = [["google-site-verification=abc"], ["v=spf1 include:x ~all"]];
    expect(findSpf(records)).toBe("v=spf1 include:x ~all");
    expect(findSpf([["nothing here"]])).toBeNull();
    expect(findDmarc([["v=DMARC1; p=reject; rua=mailto:x@y"]])).toContain("p=reject");
  });

  it("reads the DMARC policy, whatever the spacing", () => {
    expect(dmarcPolicy("v=DMARC1; p=reject")).toBe("reject");
    expect(dmarcPolicy("v=DMARC1;p=quarantine;pct=100")).toBe("quarantine");
    expect(dmarcPolicy("v=DMARC1; sp=reject; p = none")).toBe("none");
    expect(dmarcPolicy(null)).toBeNull();
    // sp= is the subdomain policy and is not the answer.
    expect(dmarcPolicy("v=DMARC1; sp=reject")).toBeNull();
  });

  it("says what is missing rather than only what is there", () => {
    const bare = emailFindings({ spf: null, dmarc: null, dmarcPolicy: null, dkimSelectors: [] });
    expect(bare.filter((f) => f.severity === "warn")).toHaveLength(3);
    expect(bare[0]?.message).toContain("No SPF");

    const monitoring = emailFindings({
      spf: "v=spf1 -all",
      dmarc: "v=DMARC1; p=none",
      dmarcPolicy: "none",
      dkimSelectors: ["google"],
    });
    expect(monitoring[1]?.severity).toBe("warn");
    expect(monitoring[1]?.message).toContain("nothing is enforced");
    expect(monitoring[2]?.message).toContain("google");
  });
});
