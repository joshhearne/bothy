/**
 * Everything a domain check has to interpret, kept away from the sockets that
 * fetch it. RDAP responses and TXT records are other people's data in other
 * people's formats, so this is where the defensiveness lives.
 */

export type Severity = "ok" | "warn" | "bad";

export type Finding = { severity: Severity; message: string };

/** A certificate expiring sooner than this is worth saying out loud. */
export const TLS_WARN_DAYS = 30;
/** Domains are renewed on longer notice than certificates. */
export const DOMAIN_WARN_DAYS = 60;

export function daysUntil(when: Date, now: Date = new Date()): number {
  return Math.floor((when.getTime() - now.getTime()) / 86_400_000);
}

/* ---------- TLS ---------- */

export type CertificateSummary = {
  issuer: string | null;
  subject: string | null;
  names: string[];
  validFrom: string | null;
  validTo: string | null;
  daysRemaining: number | null;
  chainTrusted: boolean;
  chainError: string | null;
  coversDomain: boolean;
};

/** OpenSSL dates ("Nov 14 12:00:00 2026 GMT") parse, but only as UTC. */
export function parseCertificateDate(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** "DNS:example.com, DNS:*.example.com" as the socket reports it. */
export function parseSubjectAltNames(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.toLowerCase().startsWith("dns:"))
    .map((entry) => entry.slice(4).trim().toLowerCase())
    .filter(Boolean);
}

/** A single wildcard matches one label, and never the apex. */
export function nameMatches(domain: string, pattern: string): boolean {
  const name = domain.toLowerCase();
  const candidate = pattern.toLowerCase();
  if (candidate === name) return true;
  if (!candidate.startsWith("*.")) return false;

  const suffix = candidate.slice(2);
  if (!name.endsWith(`.${suffix}`)) return false;
  return name.slice(0, -(suffix.length + 1)).includes(".") === false;
}

export function certificateFindings(cert: CertificateSummary): Finding[] {
  const findings: Finding[] = [];

  if (!cert.chainTrusted) {
    findings.push({
      severity: "bad",
      message: cert.chainError
        ? `The certificate chain is not trusted (${cert.chainError}).`
        : "The certificate chain is not trusted.",
    });
  }
  if (!cert.coversDomain) {
    findings.push({ severity: "bad", message: "The certificate does not cover this domain." });
  }

  const days = cert.daysRemaining;
  if (days === null) return findings;

  if (days < 0) findings.push({ severity: "bad", message: `The certificate expired ${-days} days ago.` });
  else if (days <= TLS_WARN_DAYS) {
    findings.push({ severity: "warn", message: `The certificate expires in ${days} days.` });
  } else findings.push({ severity: "ok", message: `The certificate is valid for ${days} more days.` });

  return findings;
}

/* ---------- RDAP ---------- */

export type RegistrationSummary = {
  registrar: string | null;
  registered: string | null;
  expires: string | null;
  daysRemaining: number | null;
  statuses: string[];
  locked: boolean;
};

type RdapEvent = { eventAction?: unknown; eventDate?: unknown };
type RdapEntity = { roles?: unknown; vcardArray?: unknown };

function vcardName(entity: RdapEntity): string | null {
  // ["vcard", [["version",{},"text","4.0"], ["fn",{},"text","GoDaddy"], …]]
  const card = Array.isArray(entity.vcardArray) ? entity.vcardArray[1] : null;
  if (!Array.isArray(card)) return null;

  for (const entry of card) {
    if (Array.isArray(entry) && entry[0] === "fn" && typeof entry[3] === "string") {
      return entry[3].trim() || null;
    }
  }
  return null;
}

export function parseRdap(body: unknown, now: Date = new Date()): RegistrationSummary {
  const record = (body ?? {}) as { events?: unknown; entities?: unknown; status?: unknown };

  const events = Array.isArray(record.events) ? (record.events as RdapEvent[]) : [];
  const dateFor = (action: string): string | null => {
    const found = events.find(
      (event) => typeof event.eventAction === "string" && event.eventAction === action,
    );
    if (!found || typeof found.eventDate !== "string") return null;
    const parsed = new Date(found.eventDate);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  };

  const entities = Array.isArray(record.entities) ? (record.entities as RdapEntity[]) : [];
  const registrar =
    entities
      .filter((entity) => Array.isArray(entity.roles) && entity.roles.includes("registrar"))
      .map(vcardName)
      .find((name): name is string => Boolean(name)) ?? null;

  const statuses = Array.isArray(record.status)
    ? record.status.filter((value): value is string => typeof value === "string")
    : [];

  const expires = dateFor("expiration");

  return {
    registrar,
    registered: dateFor("registration"),
    expires,
    daysRemaining: expires ? daysUntil(new Date(expires), now) : null,
    statuses,
    // Any of the transfer locks counts: registries name them differently.
    locked: statuses.some((status) => status.toLowerCase().includes("transfer prohibited")),
  };
}

export function registrationFindings(record: RegistrationSummary): Finding[] {
  const findings: Finding[] = [];
  const days = record.daysRemaining;

  if (days !== null) {
    if (days < 0) findings.push({ severity: "bad", message: `The registration lapsed ${-days} days ago.` });
    else if (days <= DOMAIN_WARN_DAYS) {
      findings.push({ severity: "warn", message: `The registration expires in ${days} days.` });
    } else findings.push({ severity: "ok", message: `The registration runs for ${days} more days.` });
  }

  if (!record.locked && record.statuses.length > 0) {
    findings.push({ severity: "warn", message: "No transfer lock is set at the registrar." });
  }
  return findings;
}

/* ---------- Email posture ---------- */

export type EmailSummary = {
  spf: string | null;
  dmarc: string | null;
  dmarcPolicy: string | null;
  dkimSelectors: string[];
};

/** A TXT record arrives as chunks that have to be joined before reading. */
export function joinTxt(record: string[] | string): string {
  return Array.isArray(record) ? record.join("") : record;
}

export function findSpf(records: (string[] | string)[]): string | null {
  return records.map(joinTxt).find((value) => /^v=spf1\b/i.test(value.trim())) ?? null;
}

export function findDmarc(records: (string[] | string)[]): string | null {
  return records.map(joinTxt).find((value) => /^v=dmarc1\b/i.test(value.trim())) ?? null;
}

export function dmarcPolicy(record: string | null): string | null {
  if (!record) return null;
  const found = /(?:^|;)\s*p\s*=\s*([a-z]+)/i.exec(record);
  return found?.[1]?.toLowerCase() ?? null;
}

export function emailFindings(summary: EmailSummary): Finding[] {
  const findings: Finding[] = [];

  findings.push(
    summary.spf
      ? { severity: "ok", message: "SPF is published." }
      : { severity: "warn", message: "No SPF record: anyone may send as this domain." },
  );

  if (!summary.dmarc) {
    findings.push({ severity: "warn", message: "No DMARC record." });
  } else if (summary.dmarcPolicy === "none" || summary.dmarcPolicy === null) {
    findings.push({
      severity: "warn",
      message: "DMARC is published but its policy is none, so nothing is enforced.",
    });
  } else {
    findings.push({ severity: "ok", message: `DMARC policy is ${summary.dmarcPolicy}.` });
  }

  if (summary.dkimSelectors.length === 0) {
    findings.push({
      severity: "warn",
      message: "No DKIM key found at the selectors that were tried.",
    });
  } else {
    findings.push({
      severity: "ok",
      message: `DKIM found at ${summary.dkimSelectors.join(", ")}.`,
    });
  }
  return findings;
}
