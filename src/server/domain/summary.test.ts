import { describe, expect, it, test } from "vitest";
import { diffSummary, expiring, summarize, type DomainSummary } from "@/server/domain/summary";
import type { DomainCheckResult } from "@/server/domain/run";

type Ok<T> = { ok: true; data: T; findings: never[] };

const DNS = {
  a: ["203.0.113.10"],
  aaaa: [],
  mx: [{ exchange: "mx1.example.net", priority: 10 }],
  ns: ["Dale.ns.cloudflare.com", "serena.ns.cloudflare.com"],
  txt: ["v=spf1 -all"],
  cname: [],
};
const TLS = {
  issuer: "Let's Encrypt",
  subject: "example.com",
  names: ["example.com"],
  validFrom: "2026-09-01T00:00:00.000Z",
  validTo: "2026-11-30T00:00:00.000Z",
  daysRemaining: 53,
  chainTrusted: true,
  chainError: null,
  coversDomain: true,
};
const RDAP = {
  registrar: "GoDaddy",
  registered: "2010-01-01T00:00:00.000Z",
  expires: "2027-08-13T00:00:00.000Z",
  daysRemaining: 309,
  statuses: ["client transfer prohibited"],
  locked: true,
};
const EMAIL = { spf: "v=spf1 -all", dmarc: "v=DMARC1; p=reject", dmarcPolicy: "reject", dkimSelectors: ["google"] };

const ok = <T,>(data: T): Ok<T> => ({ ok: true, data, findings: [] });

function result(overrides: Partial<DomainCheckResult> = {}): DomainCheckResult {
  return {
    domain: "example.com",
    checkedAt: "2026-10-08T00:00:00.000Z",
    dns: ok(DNS),
    tls: ok(TLS),
    rdap: ok(RDAP),
    email: ok(EMAIL),
    ...overrides,
  };
}

describe("summarize", () => {
  test("keeps the facts worth comparing, normalised", () => {
    const summary = summarize(result());
    expect(summary.ns).toEqual(["dale.ns.cloudflare.com", "serena.ns.cloudflare.com"]);
    expect(summary.certValidTo).toBe("2026-11-30");
    expect(summary.registrationExpires).toBe("2027-08-13");
    expect(summary.spf).toBe(true);
    expect(summary.dmarcPolicy).toBe("reject");
    expect(summary.dkim).toBe(true);
    expect(summary.certTrusted).toBe(true);
  });

  test("a section that was off, or failed, is unknown rather than empty", () => {
    const summary = summarize(result({ tls: undefined, rdap: { ok: false, error: "nope" } }));
    expect(summary.certValidTo).toBeNull();
    expect(summary.registrar).toBeNull();
    expect(summary.resolves).toBe(true);
  });
});

describe("diffSummary", () => {
  const before = summarize(result());

  test("nothing changed, nothing said", () => {
    expect(diffSummary(before, summarize(result()))).toEqual([]);
  });

  test("the first run has nothing to compare with", () => {
    expect(diffSummary(null, before)).toEqual([]);
  });

  test("name servers and addresses moving are reported, order ignored", () => {
    const after = summarize(
      result({ dns: ok({ ...DNS, ns: ["ns2.other.example", "ns1.other.example"], a: ["198.51.100.7"] }) }),
    );
    const whats = diffSummary(before, after).map((change) => change.what);
    expect(whats).toEqual(["ns", "a"]);
  });

  test("a section that became unknown is not a change", () => {
    const after = summarize(result({ tls: { ok: false, error: "Nothing answered on port 443." } }));
    expect(diffSummary(before, after)).toEqual([]);
  });

  test("a renewed certificate, a lost DMARC policy, a dropped lock", () => {
    const after = summarize(
      result({
        tls: ok({ ...TLS, validTo: "2027-02-28T00:00:00.000Z" }),
        email: ok({ ...EMAIL, dmarcPolicy: "none" }),
        rdap: ok({ ...RDAP, locked: false }),
      }),
    );
    const changes = diffSummary(before, after);
    expect(changes.map((change) => change.what)).toEqual(["certificate", "transfer_lock", "dmarc"]);
    expect(changes.find((change) => change.what === "certificate")?.to).toContain("2027-02-28");
  });
});

describe("expiring", () => {
  const now = new Date("2026-10-08T12:00:00Z");

  test("inside the window counts, outside does not", () => {
    const summary: DomainSummary = {
      ...summarize(result()),
      certValidTo: "2026-10-20",
      registrationExpires: "2027-08-13",
    };
    const soon = expiring(summary, now);
    expect(soon).toEqual([{ kind: "certificate", expiresOn: "2026-10-20", daysRemaining: 12 }]);
  });

  test("already past still counts, with negative days", () => {
    const summary: DomainSummary = { ...summarize(result()), certValidTo: "2026-10-01", registrationExpires: "2026-10-05" };
    expect(expiring(summary, now).map((item) => item.daysRemaining)).toEqual([-7, -3]);
  });
});

describe("expiring with a notice", () => {
  const base: DomainSummary = {
    resolves: true, ns: [], a: [], mx: [], certIssuer: "x", certValidTo: "2026-10-20",
    certTrusted: true, certCovers: true, registrar: null, registrationExpires: null,
    locked: null, spf: null, dmarcPolicy: null, dkim: null,
  };
  const now = new Date("2026-10-08T00:00:00Z");

  it("announces the certificate inside the notice it was given", () => {
    expect(expiring(base, now, { certificateWarnDays: 14 })).toHaveLength(1);
    expect(expiring(base, now, { certificateWarnDays: 7 })).toHaveLength(0);
  });

  it("never announces a certificate that renews itself", () => {
    expect(expiring(base, now, { certificateWarnDays: null })).toHaveLength(0);
  });
});
