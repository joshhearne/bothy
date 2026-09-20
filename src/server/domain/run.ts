import "server-only";
import { Resolver } from "node:dns/promises";
import { connect, type PeerCertificate } from "node:tls";
import { isWorkers } from "@/lib/runtime";
import { PRODUCT_NAME, SOURCE_URL } from "@/lib/app-meta";
import { publicOnly } from "@/server/domain/addresses";
import {
  certificateFindings,
  daysUntil,
  dmarcPolicy,
  emailFindings,
  findDmarc,
  findSpf,
  nameMatches,
  parseCertificateDate,
  parseRdap,
  parseSubjectAltNames,
  registrationFindings,
  type CertificateSummary,
  type EmailSummary,
  type Finding,
  type RegistrationSummary,
} from "@/server/domain/parse";

/**
 * The lookups themselves. Everything here is outbound traffic on behalf of a
 * user-supplied name, so: a short timeout on every call, public addresses
 * only, and a connection made to the address that was checked rather than to
 * the name, which is what stops a rebind pointing us back inside.
 */

const TIMEOUT_MS = 5_000;

/** Tried in order; most domains that sign mail use one of these. */
const DKIM_SELECTORS = ["google", "selector1", "selector2", "default", "k1", "s1", "mail", "dkim"];

export type Section<T> = { ok: true; data: T; findings: Finding[] } | { ok: false; error: string };

export type DnsSummary = {
  a: string[];
  aaaa: string[];
  mx: { exchange: string; priority: number }[];
  ns: string[];
  txt: string[];
  cname: string[];
};

export type DomainCheckResult = {
  domain: string;
  checkedAt: string;
  dns?: Section<DnsSummary>;
  tls?: Section<CertificateSummary>;
  rdap?: Section<RegistrationSummary>;
  email?: Section<EmailSummary>;
};

export type CheckSelection = { dns: boolean; tls: boolean; rdap: boolean; email: boolean };

function resolver(): Resolver {
  const instance = new Resolver({ timeout: TIMEOUT_MS, tries: 2 });
  return instance;
}

/** A lookup that finds nothing is not a failure: plenty of domains have no MX. */
async function maybe<T>(work: Promise<T>): Promise<T | null> {
  try {
    return await work;
  } catch {
    return null;
  }
}

function unavailable(): { ok: false; error: string } {
  return {
    ok: false,
    error: "Lookups are not available in this deployment.",
  };
}

async function runDns(domain: string): Promise<Section<DnsSummary>> {
  if (isWorkers()) return unavailable();
  const dns = resolver();

  const [a, aaaa, mx, ns, txt, cname] = await Promise.all([
    maybe(dns.resolve4(domain)),
    maybe(dns.resolve6(domain)),
    maybe(dns.resolveMx(domain)),
    maybe(dns.resolveNs(domain)),
    maybe(dns.resolveTxt(domain)),
    maybe(dns.resolveCname(domain)),
  ]);

  // Nothing at all means the name does not resolve, which is worth saying.
  if (!a && !aaaa && !ns && !cname) {
    return { ok: false, error: "The domain does not resolve." };
  }

  const data: DnsSummary = {
    a: a ?? [],
    aaaa: aaaa ?? [],
    mx: (mx ?? []).map((record) => ({ exchange: record.exchange, priority: record.priority })),
    ns: (ns ?? []).map((host) => host.toLowerCase()),
    txt: (txt ?? []).map((chunks) => chunks.join("")),
    cname: cname ?? [],
  };

  const findings: Finding[] = [];
  if (data.mx.length === 0) {
    findings.push({ severity: "warn", message: "No MX records: this domain receives no mail." });
  }
  if (data.ns.length > 0) {
    findings.push({ severity: "ok", message: `Answered by ${data.ns.join(", ")}.` });
  }
  return { ok: true, data, findings };
}

async function runTls(domain: string): Promise<Section<CertificateSummary>> {
  if (isWorkers()) return unavailable();
  const dns = resolver();

  const [a, aaaa] = await Promise.all([maybe(dns.resolve4(domain)), maybe(dns.resolve6(domain))]);
  const address = publicOnly([...(a ?? []), ...(aaaa ?? [])])[0];
  if (!address) {
    return {
      ok: false,
      error: "No public address to connect to, so no certificate was fetched.",
    };
  }

  const certificate = await new Promise<PeerCertificate | null>((resolve) => {
    const socket = connect({
      host: address,
      port: 443,
      // The name is presented for SNI and checked below; the connection goes
      // to the address that was just vetted.
      servername: domain,
      // An untrusted chain is a finding to report, not an error to throw.
      rejectUnauthorized: false,
      timeout: TIMEOUT_MS,
    });

    const finish = (value: PeerCertificate | null) => {
      socket.destroy();
      resolve(value);
    };

    socket.once("secureConnect", () => {
      const peer = socket.getPeerCertificate(true);
      const authorized = socket.authorized;
      const error = socket.authorizationError;
      finish(
        Object.assign(peer, {
          __authorized: authorized,
          __error: error ? String(error) : null,
        }) as PeerCertificate,
      );
    });
    socket.once("timeout", () => finish(null));
    socket.once("error", () => finish(null));
  });

  if (!certificate || Object.keys(certificate).length === 0) {
    return { ok: false, error: "Nothing answered on port 443." };
  }

  const extras = certificate as PeerCertificate & { __authorized?: boolean; __error?: string | null };
  const validTo = parseCertificateDate(certificate.valid_to);
  const validFrom = parseCertificateDate(certificate.valid_from);
  const names = parseSubjectAltNames(certificate.subjectaltname);
  const subject = firstValue(certificate.subject?.CN);
  const covered = [...names, ...(subject ? [subject.toLowerCase()] : [])];

  const data: CertificateSummary = {
    issuer: firstValue(certificate.issuer?.O) ?? firstValue(certificate.issuer?.CN),
    subject,
    names,
    validFrom: validFrom?.toISOString() ?? null,
    validTo: validTo?.toISOString() ?? null,
    daysRemaining: validTo ? daysUntil(validTo) : null,
    chainTrusted: extras.__authorized === true,
    chainError: extras.__error ?? null,
    coversDomain: covered.some((pattern) => nameMatches(domain, pattern)),
  };

  return { ok: true, data, findings: certificateFindings(data) };
}

/** A certificate name part repeats when the RDN does, so take the first. */
function firstValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

async function runRdap(domain: string): Promise<Section<RegistrationSummary>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    // rdap.org redirects to whichever registry actually holds the name. It
    // refuses a request with no User-Agent, and fetch sends none by default.
    const response = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
      headers: {
        Accept: "application/rdap+json",
        "User-Agent": `${PRODUCT_NAME}/1.0 (+${SOURCE_URL})`,
      },
      signal: controller.signal,
      redirect: "follow",
    });

    if (response.status === 404) return { ok: false, error: "No registration record was found." };
    if (!response.ok) return { ok: false, error: `The registry answered ${response.status}.` };

    const data = parseRdap(await response.json());
    return { ok: true, data, findings: registrationFindings(data) };
  } catch {
    return { ok: false, error: "The registry could not be reached." };
  } finally {
    clearTimeout(timer);
  }
}

async function runEmail(domain: string): Promise<Section<EmailSummary>> {
  if (isWorkers()) return unavailable();
  const dns = resolver();

  const [apex, dmarc] = await Promise.all([
    maybe(dns.resolveTxt(domain)),
    maybe(dns.resolveTxt(`_dmarc.${domain}`)),
  ]);

  // DKIM keys live under a selector that cannot be listed, so the common ones
  // are tried and the answer says which were looked for.
  const found = await Promise.all(
    DKIM_SELECTORS.map(async (selector) => {
      const record = await maybe(dns.resolveTxt(`${selector}._domainkey.${domain}`));
      return record && record.length > 0 ? selector : null;
    }),
  );

  const dmarcRecord = findDmarc(dmarc ?? []);
  const data: EmailSummary = {
    spf: findSpf(apex ?? []),
    dmarc: dmarcRecord,
    dmarcPolicy: dmarcPolicy(dmarcRecord),
    dkimSelectors: found.filter((selector): selector is string => selector !== null),
  };

  return { ok: true, data, findings: emailFindings(data) };
}

/** Runs the checks that are turned on, in parallel, and never throws. */
export async function runChecks(
  domain: string,
  selection: CheckSelection,
): Promise<DomainCheckResult> {
  const [dns, tls, rdap, email] = await Promise.all([
    selection.dns ? runDns(domain) : undefined,
    selection.tls ? runTls(domain) : undefined,
    selection.rdap ? runRdap(domain) : undefined,
    selection.email ? runEmail(domain) : undefined,
  ]);

  return {
    domain,
    checkedAt: new Date().toISOString(),
    ...(dns ? { dns } : {}),
    ...(tls ? { tls } : {}),
    ...(rdap ? { rdap } : {}),
    ...(email ? { email } : {}),
  };
}
