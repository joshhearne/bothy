import type { DomainCheckResult } from "@/server/domain/run";
import { DOMAIN_WARN_DAYS, TLS_WARN_DAYS } from "@/server/domain/parse";

export type ExpiryNotice = {
  /** Days ahead to announce the certificate, or null for a certificate that renews itself. */
  certificateWarnDays: number | null;
};

/**
 * What a run found, boiled down to the handful of facts worth comparing with
 * the last run: who answers DNS, where the name points, who signs the
 * certificate and until when, who the registrar is, when the registration
 * ends, and whether mail is protected. The full result is kept for reading;
 * this is kept for noticing.
 *
 * Null means "not looked at", never "absent": a section that was turned off
 * or failed is unknown, and an unknown is never a change.
 */
export type DomainSummary = {
  resolves: boolean | null;
  ns: string[] | null;
  a: string[] | null;
  mx: string[] | null;
  certIssuer: string | null;
  certValidTo: string | null;
  certTrusted: boolean | null;
  certCovers: boolean | null;
  registrar: string | null;
  registrationExpires: string | null;
  locked: boolean | null;
  spf: boolean | null;
  dmarcPolicy: string | null;
  dkim: boolean | null;
};

export type ChangeWhat =
  | "resolves"
  | "ns"
  | "a"
  | "mx"
  | "certificate"
  | "certificate_trust"
  | "registrar"
  | "registration_expiry"
  | "transfer_lock"
  | "spf"
  | "dmarc"
  | "dkim";

export type Change = {
  what: ChangeWhat;
  from: string | null;
  to: string | null;
  message: string;
};

export type ExpiryKind = "certificate" | "registration";

export type Expiring = {
  kind: ExpiryKind;
  expiresOn: string;
  daysRemaining: number;
};

const sorted = (values: string[]) =>
  [...values].map((v) => v.toLowerCase()).sort();

export function summarize(result: DomainCheckResult): DomainSummary {
  const dns = result.dns;
  const tls = result.tls;
  const rdap = result.rdap;
  const email = result.email;

  return {
    resolves: dns ? dns.ok : null,
    ns: dns?.ok ? sorted(dns.data.ns) : null,
    a: dns?.ok ? sorted([...dns.data.a, ...dns.data.aaaa]) : null,
    mx: dns?.ok ? sorted(dns.data.mx.map((mx) => mx.exchange)) : null,
    certIssuer: tls?.ok ? tls.data.issuer : null,
    certValidTo: tls?.ok ? (tls.data.validTo?.slice(0, 10) ?? null) : null,
    certTrusted: tls?.ok
      ? tls.data.chainTrusted && tls.data.coversDomain
      : null,
    certCovers: tls?.ok ? tls.data.coversDomain : null,
    registrar: rdap?.ok ? rdap.data.registrar : null,
    registrationExpires: rdap?.ok
      ? (rdap.data.expires?.slice(0, 10) ?? null)
      : null,
    locked: rdap?.ok ? rdap.data.locked : null,
    spf: email?.ok ? email.data.spf !== null : null,
    dmarcPolicy: email?.ok ? email.data.dmarcPolicy : null,
    dkim: email?.ok ? email.data.dkimSelectors.length > 0 : null,
  };
}

const list = (values: string[] | null) =>
  values && values.length > 0 ? values.join(", ") : "none";
const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * What differs between two runs. Only facts known on both sides are compared,
 * so turning a check on, or a lookup failing once, does not read as a change.
 */
export function diffSummary(
  before: DomainSummary | null,
  after: DomainSummary,
): Change[] {
  if (!before) return [];
  const changes: Change[] = [];

  const known = <T>(a: T | null, b: T | null): boolean =>
    a !== null && b !== null;

  if (
    known(before.resolves, after.resolves) &&
    before.resolves !== after.resolves
  ) {
    changes.push({
      what: "resolves",
      from: String(before.resolves),
      to: String(after.resolves),
      message: after.resolves
        ? "The domain resolves again."
        : "The domain no longer resolves.",
    });
  }
  if (before.ns && after.ns && !sameList(before.ns, after.ns)) {
    changes.push({
      what: "ns",
      from: list(before.ns),
      to: list(after.ns),
      message: `Name servers changed from ${list(before.ns)} to ${list(after.ns)}.`,
    });
  }
  if (before.a && after.a && !sameList(before.a, after.a)) {
    changes.push({
      what: "a",
      from: list(before.a),
      to: list(after.a),
      message: `The domain now points at ${list(after.a)} (was ${list(before.a)}).`,
    });
  }
  if (before.mx && after.mx && !sameList(before.mx, after.mx)) {
    changes.push({
      what: "mx",
      from: list(before.mx),
      to: list(after.mx),
      message: `Mail is now handled by ${list(after.mx)} (was ${list(before.mx)}).`,
    });
  }
  if (
    known(before.certValidTo, after.certValidTo) &&
    (before.certValidTo !== after.certValidTo ||
      before.certIssuer !== after.certIssuer)
  ) {
    changes.push({
      what: "certificate",
      from: `${before.certIssuer ?? "unknown issuer"} until ${before.certValidTo}`,
      to: `${after.certIssuer ?? "unknown issuer"} until ${after.certValidTo}`,
      message: `A new certificate from ${after.certIssuer ?? "an unknown issuer"}, valid until ${after.certValidTo}.`,
    });
  }
  if (
    known(before.certTrusted, after.certTrusted) &&
    before.certTrusted !== after.certTrusted
  ) {
    changes.push({
      what: "certificate_trust",
      from: String(before.certTrusted),
      to: String(after.certTrusted),
      message: after.certTrusted
        ? "The certificate is trusted and covers the domain again."
        : "The certificate is no longer trusted for this domain.",
    });
  }
  if (
    known(before.registrar, after.registrar) &&
    before.registrar !== after.registrar
  ) {
    changes.push({
      what: "registrar",
      from: before.registrar,
      to: after.registrar,
      message: `The registrar changed from ${before.registrar} to ${after.registrar}.`,
    });
  }
  if (
    known(before.registrationExpires, after.registrationExpires) &&
    before.registrationExpires !== after.registrationExpires
  ) {
    changes.push({
      what: "registration_expiry",
      from: before.registrationExpires,
      to: after.registrationExpires,
      message: `The registration now runs until ${after.registrationExpires} (was ${before.registrationExpires}).`,
    });
  }
  if (known(before.locked, after.locked) && before.locked !== after.locked) {
    changes.push({
      what: "transfer_lock",
      from: String(before.locked),
      to: String(after.locked),
      message: after.locked
        ? "A transfer lock is now set."
        : "The transfer lock was removed.",
    });
  }
  if (known(before.spf, after.spf) && before.spf !== after.spf) {
    changes.push({
      what: "spf",
      from: String(before.spf),
      to: String(after.spf),
      message: after.spf
        ? "SPF is published again."
        : "The SPF record is gone.",
    });
  }
  if (
    known(before.dmarcPolicy, after.dmarcPolicy) &&
    before.dmarcPolicy !== after.dmarcPolicy
  ) {
    changes.push({
      what: "dmarc",
      from: before.dmarcPolicy,
      to: after.dmarcPolicy,
      message: `DMARC policy changed from ${before.dmarcPolicy} to ${after.dmarcPolicy}.`,
    });
  }
  if (known(before.dkim, after.dkim) && before.dkim !== after.dkim) {
    changes.push({
      what: "dkim",
      from: String(before.dkim),
      to: String(after.dkim),
      message: after.dkim
        ? "A DKIM key is published again."
        : "No DKIM key is published any more.",
    });
  }
  return changes;
}

/** Days from today to a calendar date, as whole days. */
function daysTo(date: string, now: Date): number {
  const at = Date.parse(`${date}T00:00:00Z`);
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  return Math.round((at - today) / 86_400_000);
}

/**
 * What is inside its warning window: the certificate within the notice the
 * policy gives it (none for one that renews itself), the registration within
 * DOMAIN_WARN_DAYS, the same thresholds the findings use, so a warning in the
 * result and an announcement agree.
 */
export function expiring(
  summary: DomainSummary,
  now: Date = new Date(),
  notice: ExpiryNotice = { certificateWarnDays: TLS_WARN_DAYS },
): Expiring[] {
  const out: Expiring[] = [];
  if (summary.certValidTo && notice.certificateWarnDays !== null) {
    const days = daysTo(summary.certValidTo, now);
    if (days <= notice.certificateWarnDays) {
      out.push({
        kind: "certificate",
        expiresOn: summary.certValidTo,
        daysRemaining: days,
      });
    }
  }
  if (summary.registrationExpires) {
    const days = daysTo(summary.registrationExpires, now);
    if (days <= DOMAIN_WARN_DAYS) {
      out.push({
        kind: "registration",
        expiresOn: summary.registrationExpires,
        daysRemaining: days,
      });
    }
  }
  return out;
}
