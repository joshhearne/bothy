import "server-only";
import { and, asc, eq, isNull, isNotNull, lte, or, sql } from "drizzle-orm";
import { db, type Executor } from "@/server/db";
import {
  companies,
  docTypes,
  documents,
  domainChecks,
  fields,
} from "@/server/db/schema";
import { writeAudit } from "@/server/services/audit";
import { NotFoundError } from "@/server/services/errors";
import {
  assertDocumentInScope,
  saveDocument,
} from "@/server/services/documents";
import { queueEvent } from "@/server/services/webhooks";
import { getDomainCheckPolicy } from "@/server/services/settings";
import { companyPolicyOf } from "@/server/services/companies";
import { scopeWhere, type CompanyScope } from "@/server/auth/company-scope";
import { optionItems } from "@/server/db/schema";
import { addOptionItem } from "@/server/services/option-lists";
import { normalizeDomain } from "@/server/domain/hostname";
import {
  runChecks,
  type CheckSelection,
  type DomainCheckResult,
} from "@/server/domain/run";
import {
  CHECK_KINDS,
  certificateWarnDays,
  dueKinds,
  intervalOrNull,
  resolvePolicy,
  scheduleAfterRun,
  soonest,
  type CheckKind,
  type CheckPolicy,
  type PolicyOverrides,
} from "@/server/domain/policy";
import type { Finding } from "@/server/domain/parse";
import {
  diffSummary,
  expiring,
  summarize,
  type Change,
  type DomainSummary,
  type ExpiryKind,
} from "@/server/domain/summary";

/**
 * Domain checks for one document: which lookups it runs, what the last run
 * found, and the fields a result may offer to fill in.
 *
 * A document can run checks when its doc type has a field marked as holding a
 * domain, so this is not wired to one doc type's labels: an operator can point
 * it at a field on a doc type of their own.
 */

export type DomainRole = "domain" | "expiry" | "registrar" | "dns_host";

/** What a record says for itself: an interval per kind where it has one, and its certificate's renewal. */
export type RecordPolicy = {
  intervals: Record<CheckKind, number | null>;
  tlsAutoRenews: boolean;
  tlsWarnDays: number | null;
};

export type DomainAutomation = {
  /** Whether the worker runs this record's checks on its own. */
  auto: boolean;
  /** The record's own say. */
  own: RecordPolicy;
  /** The company's say, where it has one, so the form can show what "default" means. */
  company: PolicyOverrides;
  /** The instance's say, beneath the company's. */
  instance: CheckPolicy;
  /** What applies here once the three layers are read together. */
  effective: CheckPolicy;
  /** Days ahead of certificate expiry a warning goes out, or null for none. */
  certificateWarnDays: number | null;
  nextRuns: Record<CheckKind, Date | null>;
  nextRunAt: Date | null;
  /** Why the last automatic run could not check anything, if it could not. */
  autoError: string | null;
};

export type DomainCheckState = {
  /** Null when this doc type has no field marked as a domain. */
  domain: string | null;
  /** What was typed, when it is not a domain we can look up. */
  rawDomain: string | null;
  selection: CheckSelection;
  result: DomainCheckResult | null;
  checkedAt: Date | null;
  /** True when the last run was the worker's rather than a person's. */
  automatic: boolean;
  automation: DomainAutomation;
  /** Field ids a suggestion can be written to, by role. */
  targets: Partial<Record<DomainRole, string>>;
};

export class NoDomainFieldError extends Error {
  constructor() {
    super("This doc type has no field marked as holding a domain");
    this.name = "NoDomainFieldError";
  }
}

export class NotADomainError extends Error {
  constructor() {
    super("That does not look like a domain name");
    this.name = "NotADomainError";
  }
}

export class SuggestionRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SuggestionRejectedError";
  }
}

export class TooManyChecksError extends Error {
  constructor() {
    super("Too many checks at once. Try again in a minute.");
    this.name = "TooManyChecksError";
  }
}

/*
 * Checks reach out to other people's servers, so the whole instance shares one
 * modest budget. ARCHITECTURE rules out Redis, and one container is the
 * supported deployment, so this is the whole limiter.
 */
const WINDOW_MS = 60_000;
const MAX_RUNS = 30;
let window = { count: 0, resetAt: 0 };

function takeToken(): boolean {
  const now = Date.now();
  if (window.resetAt <= now) window = { count: 0, resetAt: now + WINDOW_MS };
  if (window.count >= MAX_RUNS) return false;
  window.count += 1;
  return true;
}

type CheckRow = typeof domainChecks.$inferSelect;

function selectionOf(
  row: Pick<CheckRow, "dns" | "tls" | "rdap" | "email"> | undefined,
): CheckSelection {
  return {
    dns: row?.dns ?? false,
    tls: row?.tls ?? false,
    rdap: row?.rdap ?? false,
    email: row?.email ?? false,
  };
}

function recordPolicyOf(row: CheckRow | undefined): RecordPolicy {
  return {
    intervals: {
      dns: row?.dnsIntervalDays ?? null,
      tls: row?.tlsIntervalDays ?? null,
      rdap: row?.rdapIntervalDays ?? null,
      email: row?.emailIntervalDays ?? null,
    },
    tlsAutoRenews: row?.tlsAutoRenews ?? false,
    tlsWarnDays: row?.tlsWarnDays ?? null,
  };
}

function nextRunsOf(row: CheckRow | undefined): Record<CheckKind, Date | null> {
  return {
    dns: row?.dnsNextRunAt ?? null,
    tls: row?.tlsNextRunAt ?? null,
    rdap: row?.rdapNextRunAt ?? null,
    email: row?.emailNextRunAt ?? null,
  };
}

function nextRunColumns(next: Record<CheckKind, Date | null>) {
  return {
    dnsNextRunAt: next.dns,
    tlsNextRunAt: next.tls,
    rdapNextRunAt: next.rdap,
    emailNextRunAt: next.email,
    nextRunAt: soonest(next),
  };
}

/** The three layers for one document's record, read together. */
async function policyFor(
  companyId: string,
  own: RecordPolicy,
): Promise<{
  instance: CheckPolicy;
  company: PolicyOverrides;
  effective: CheckPolicy;
}> {
  const [instance, [company]] = await Promise.all([
    getDomainCheckPolicy(),
    db
      .select({
        domainDnsIntervalDays: companies.domainDnsIntervalDays,
        domainTlsIntervalDays: companies.domainTlsIntervalDays,
        domainRdapIntervalDays: companies.domainRdapIntervalDays,
        domainEmailIntervalDays: companies.domainEmailIntervalDays,
        domainTlsWarnDays: companies.domainTlsWarnDays,
      })
      .from(companies)
      .where(eq(companies.id, companyId))
      .limit(1),
  ]);
  const companyPolicy = companyPolicyOf(company);
  return {
    instance,
    company: companyPolicy,
    effective: resolvePolicy(instance, companyPolicy, {
      intervals: own.intervals,
      tlsWarnDays: own.tlsWarnDays,
    }),
  };
}

async function roleFields(documentId: string): Promise<{
  docTypeId: string;
  companyId: string;
  targets: Partial<Record<DomainRole, string>>;
}> {
  const [document] = await db
    .select({ docTypeId: documents.docTypeId, companyId: documents.companyId })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);
  if (!document) throw new NotFoundError("Document");

  const rows = await db
    .select({ id: fields.id, role: fields.domainRole })
    .from(fields)
    .where(
      and(eq(fields.docTypeId, document.docTypeId), isNull(fields.archivedAt)),
    );

  const targets: Partial<Record<DomainRole, string>> = {};
  for (const row of rows) {
    if (row.role) targets[row.role as DomainRole] = row.id;
  }
  return {
    docTypeId: document.docTypeId,
    companyId: document.companyId,
    targets,
  };
}

export async function getDomainCheckState(
  documentId: string,
  scope: CompanyScope,
): Promise<DomainCheckState> {
  await assertDocumentInScope(documentId, scope);

  const { companyId, targets } = await roleFields(documentId);
  const [row] = await db
    .select()
    .from(domainChecks)
    .where(eq(domainChecks.documentId, documentId))
    .limit(1);

  const selection = selectionOf(row);
  const own = recordPolicyOf(row);
  const layers = await policyFor(companyId, own);
  const automation: DomainAutomation = {
    auto: row?.auto ?? true,
    own,
    company: layers.company,
    instance: layers.instance,
    effective: layers.effective,
    certificateWarnDays: certificateWarnDays(layers.effective, own),
    nextRuns: nextRunsOf(row),
    nextRunAt: row?.nextRunAt ?? null,
    autoError: row?.autoError ?? null,
  };
  const automatic = Boolean(row?.checkedAt) && row?.checkedBy === null;

  const domainFieldId = targets.domain;
  if (!domainFieldId) {
    return {
      domain: null,
      rawDomain: null,
      selection,
      result: null,
      checkedAt: null,
      automatic,
      automation,
      targets,
    };
  }

  const [document] = await db
    .select({ values: documents.fieldValues })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);

  const raw = (document?.values as Record<string, unknown> | null)?.[
    domainFieldId
  ];
  const rawDomain =
    typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;

  return {
    domain: rawDomain ? normalizeDomain(rawDomain) : null,
    rawDomain,
    selection,
    result: (row?.result as DomainCheckResult | null) ?? null,
    checkedAt: row?.checkedAt ?? null,
    automatic,
    automation,
    targets,
  };
}

export type AutomationInput = {
  auto: boolean;
  /** Per kind: a number of days, or null to follow the company and instance. */
  intervals: Partial<Record<CheckKind, unknown>>;
  tlsAutoRenews: boolean;
  tlsWarnDays: unknown;
};

const NO_AUTOMATION: AutomationInput = {
  auto: true,
  intervals: {},
  tlsAutoRenews: false,
  tlsWarnDays: null,
};

/**
 * Which lookups this record runs, and how the worker treats it. The clocks
 * are brought in line with the choice straight away: a kind just turned on
 * is due now, one turned off has no next time, and the rest keep theirs.
 */
export async function setDomainChecks(
  documentId: string,
  selection: CheckSelection,
  actorId: string,
  scope: CompanyScope,
  automation: AutomationInput = NO_AUTOMATION,
): Promise<void> {
  await assertDocumentInScope(documentId, scope);
  const { companyId } = await roleFields(documentId);

  const own: RecordPolicy = {
    intervals: {
      dns: intervalOrNull(automation.intervals.dns, 1),
      tls: intervalOrNull(automation.intervals.tls, 1),
      rdap: intervalOrNull(automation.intervals.rdap, 1),
      email: intervalOrNull(automation.intervals.email, 1),
    },
    tlsAutoRenews: automation.tlsAutoRenews,
    tlsWarnDays: intervalOrNull(automation.tlsWarnDays, 1),
  };
  const { effective } = await policyFor(companyId, own);

  const [row] = await db
    .select()
    .from(domainChecks)
    .where(eq(domainChecks.documentId, documentId))
    .limit(1);
  const next = scheduleAfterRun(
    selection,
    effective,
    nextRunsOf(row),
    [],
    new Date(),
  );

  const set = {
    ...selection,
    auto: automation.auto,
    dnsIntervalDays: own.intervals.dns,
    tlsIntervalDays: own.intervals.tls,
    rdapIntervalDays: own.intervals.rdap,
    emailIntervalDays: own.intervals.email,
    tlsAutoRenews: own.tlsAutoRenews,
    tlsWarnDays: own.tlsWarnDays,
    ...nextRunColumns(next),
  };
  await db
    .insert(domainChecks)
    .values({ documentId, ...set })
    .onConflictDoUpdate({ target: domainChecks.documentId, set });
}

type Announced = Partial<Record<ExpiryKind, string>>;

/**
 * The sections that just ran replace their predecessors; the rest of the
 * last result stays, so a page shows every section at its own age and the
 * summary compares like with like. A section no longer chosen is dropped.
 */
function mergeResults(
  previous: DomainCheckResult | null,
  fresh: DomainCheckResult,
  selection: CheckSelection,
): DomainCheckResult {
  const merged: DomainCheckResult = {
    domain: fresh.domain,
    checkedAt: fresh.checkedAt,
    checked: { ...(previous?.checked ?? {}), ...(fresh.checked ?? {}) },
  };
  for (const kind of CHECK_KINDS) {
    if (!selection[kind]) {
      delete merged.checked?.[kind];
      continue;
    }
    const section = fresh[kind] ?? previous?.[kind];
    if (section) Object.assign(merged, { [kind]: section });
  }
  // A section kept from an older result with no record of when is as old as that result.
  for (const kind of CHECK_KINDS) {
    if (
      merged[kind] &&
      merged.checked &&
      !merged.checked[kind] &&
      previous?.checkedAt
    ) {
      merged.checked[kind] = previous.checkedAt;
    }
  }
  return merged;
}

/**
 * Runs some or all of a record's checks and keeps everything that follows:
 * the result (merged over the last one), the summary the next run compares
 * against, each kind's next time, an audit entry, and the webhooks: what
 * changed since last time, and what is about to expire, each expiry date
 * announced once.
 *
 * Shared by the button and the worker; the button runs every chosen kind,
 * the worker only what is due, and only the worker leaves nobody named.
 */
async function performCheck(input: {
  documentId: string;
  domain: string;
  selection: CheckSelection;
  kinds: readonly CheckKind[];
  actorId: string | null;
  previous: {
    result: DomainCheckResult | null;
    summary: DomainSummary | null;
    warned: Announced;
    nextRuns: Record<CheckKind, Date | null>;
  };
  policy: CheckPolicy;
  own: RecordPolicy;
}): Promise<DomainCheckResult> {
  const { documentId, domain, selection, kinds, actorId, policy, own } = input;
  const warnDays = certificateWarnDays(policy, own);

  const ran: CheckSelection = {
    dns: false,
    tls: false,
    rdap: false,
    email: false,
  };
  for (const kind of kinds) ran[kind] = true;
  const fresh = await runChecks(domain, ran, {
    certificate: { warnDays, autoRenews: own.tlsAutoRenews },
  });
  const result = mergeResults(input.previous.result, fresh, selection);

  const checkedAt = new Date();
  const summary = summarize(result);
  const changes = diffSummary(input.previous.summary, summary);
  const soon = expiring(summary, checkedAt, {
    certificateWarnDays: warnDays,
  }).filter((item) => input.previous.warned[item.kind] !== item.expiresOn);
  const warned: Announced = { ...input.previous.warned };
  for (const item of soon) warned[item.kind] = item.expiresOn;

  const next = scheduleAfterRun(
    selection,
    policy,
    input.previous.nextRuns,
    kinds,
    checkedAt,
  );
  const set = {
    result,
    summary,
    warned,
    checkedAt,
    checkedBy: actorId,
    autoError: null,
    ...nextRunColumns(next),
  };

  await db.transaction(async (tx) => {
    await tx
      .insert(domainChecks)
      .values({ documentId, ...selection, ...set })
      .onConflictDoUpdate({ target: domainChecks.documentId, set });

    await writeAudit(
      {
        userId: actorId,
        action: "domain.checked",
        entity: "document",
        entityId: documentId,
        detail: {
          domain,
          checks: ran,
          automatic: actorId === null,
          changes: changes.map((change) => change.what),
        },
      },
      tx,
    );

    if (changes.length > 0 || soon.length > 0) {
      await announce(tx, documentId, domain, checkedAt, changes, soon);
    }
  });

  return result;
}

async function announce(
  tx: Executor,
  documentId: string,
  domain: string,
  checkedAt: Date,
  changes: Change[],
  soon: ReturnType<typeof expiring>,
): Promise<void> {
  const [document] = await tx
    .select({ title: documents.title, companyId: documents.companyId })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);
  if (!document) return;

  const base = {
    id: documentId,
    title: document.title,
    company_id: document.companyId,
    domain,
    checked_at: checkedAt.toISOString(),
  };

  if (changes.length > 0) {
    await queueEvent("domain.changed", { ...base, changes }, tx);
  }
  for (const item of soon) {
    await queueEvent(
      "domain.expiring",
      {
        ...base,
        kind: item.kind,
        expires_on: item.expiresOn,
        days_remaining: item.daysRemaining,
      },
      tx,
    );
  }
}

/** Runs every chosen check now, on somebody's say-so, whatever the clocks say. */
export async function runDomainCheck(
  documentId: string,
  actorId: string,
  scope: CompanyScope,
): Promise<DomainCheckResult> {
  const state = await getDomainCheckState(documentId, scope);
  if (!state.targets.domain) throw new NoDomainFieldError();
  if (!state.domain) throw new NotADomainError();
  if (!takeToken()) throw new TooManyChecksError();

  const [row] = await db
    .select()
    .from(domainChecks)
    .where(eq(domainChecks.documentId, documentId))
    .limit(1);

  const anything = CHECK_KINDS.some((kind) => state.selection[kind]);
  const selection = anything
    ? state.selection
    : { dns: true, tls: true, rdap: false, email: false };

  return performCheck({
    documentId,
    domain: state.domain,
    selection,
    kinds: CHECK_KINDS.filter((kind) => selection[kind]),
    actorId,
    previous: {
      result: (row?.result as DomainCheckResult | null) ?? null,
      summary: (row?.summary as DomainSummary | null) ?? null,
      warned: (row?.warned as Announced | null) ?? {},
      nextRuns: nextRunsOf(row),
    },
    policy: state.automation.effective,
    own: state.automation.own,
  });
}

const DAY_MS = 86_400_000;

/**
 * The worker's pass: every record that asked to be checked on its own and has
 * a kind due, oldest first, within the same budget a person's clicks share.
 * Only the due kinds run; the rest keep their clocks. A record whose domain
 * cannot be looked up is told so and put off until next time rather than
 * retried every pass, and one with nothing left to run is looked at again
 * tomorrow in case its company or the instance changes its mind.
 */
export async function runDueDomainChecks(limit = 25): Promise<number> {
  const instance = await getDomainCheckPolicy();
  const now = new Date();

  const due = await db
    .select({
      row: domainChecks,
      docTypeId: documents.docTypeId,
      values: documents.fieldValues,
      company: {
        domainDnsIntervalDays: companies.domainDnsIntervalDays,
        domainTlsIntervalDays: companies.domainTlsIntervalDays,
        domainRdapIntervalDays: companies.domainRdapIntervalDays,
        domainEmailIntervalDays: companies.domainEmailIntervalDays,
        domainTlsWarnDays: companies.domainTlsWarnDays,
      },
    })
    .from(domainChecks)
    .innerJoin(documents, eq(documents.id, domainChecks.documentId))
    .innerJoin(companies, eq(companies.id, documents.companyId))
    .where(
      and(
        eq(domainChecks.auto, true),
        isNull(documents.archivedAt),
        or(
          domainChecks.dns,
          domainChecks.tls,
          domainChecks.rdap,
          domainChecks.email,
        ),
        or(isNull(domainChecks.nextRunAt), lte(domainChecks.nextRunAt, now)),
      ),
    )
    .orderBy(sql`${domainChecks.nextRunAt} ASC NULLS FIRST`)
    .limit(limit);

  let ran = 0;
  for (const { row, docTypeId, values, company } of due) {
    const own = recordPolicyOf(row);
    const policy = resolvePolicy(instance, companyPolicyOf(company), {
      intervals: own.intervals,
      tlsWarnDays: own.tlsWarnDays,
    });
    const selection = selectionOf(row);
    const kinds = dueKinds(selection, policy, nextRunsOf(row), now);

    const putOff = async (reason: string | null) => {
      // Due again when the soonest active kind is, or tomorrow when none is.
      const next = scheduleAfterRun(
        selection,
        policy,
        nextRunsOf(row),
        kinds,
        now,
      );
      await db
        .update(domainChecks)
        .set({
          autoError: reason,
          ...nextRunColumns(next),
          nextRunAt: soonest(next) ?? new Date(now.getTime() + DAY_MS),
        })
        .where(eq(domainChecks.documentId, row.documentId));
    };

    if (kinds.length === 0) {
      await putOff(null);
      continue;
    }

    const [field] = await db
      .select({ id: fields.id })
      .from(fields)
      .where(
        and(
          eq(fields.docTypeId, docTypeId),
          eq(fields.domainRole, "domain"),
          isNull(fields.archivedAt),
        ),
      )
      .limit(1);
    const raw = field
      ? (values as Record<string, unknown> | null)?.[field.id]
      : undefined;
    const rawDomain =
      typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
    const domain = rawDomain ? normalizeDomain(rawDomain) : null;

    if (!field) {
      await putOff("This doc type has no field marked as holding a domain.");
      continue;
    }
    if (!domain) {
      await putOff(
        rawDomain
          ? `“${rawDomain}” is not a domain this can look up.`
          : "The domain is empty.",
      );
      continue;
    }
    // The budget is shared with the button; when it is spent, the rest keep
    // their place in the queue for the next pass.
    if (!takeToken()) break;

    try {
      await performCheck({
        documentId: row.documentId,
        domain,
        selection,
        kinds,
        actorId: null,
        previous: {
          result: (row.result as DomainCheckResult | null) ?? null,
          summary: (row.summary as DomainSummary | null) ?? null,
          warned: (row.warned as Announced | null) ?? {},
          nextRuns: nextRunsOf(row),
        },
        policy,
        own,
      });
      ran += 1;
    } catch (error) {
      console.error("trove-kb: domain check failed", row.documentId, error);
      await putOff("The last automatic check failed. It will be tried again.");
    }
  }
  return ran;
}

export type DomainAttentionItem = {
  documentId: string;
  title: string;
  companyId: string;
  companyName: string;
  docTypeName: string;
  domain: string;
  checkedAt: Date;
  /** Everything the last run flagged, warnings and failures alike. */
  findings: Finding[];
  autoError: string | null;
};

/**
 * Every record whose last check found something worth a look, across the
 * companies the reader may see. The same facts the webhooks announce, so
 * nobody has to subscribe to one to find out.
 */
export async function listDomainAttention(
  scope: CompanyScope,
): Promise<DomainAttentionItem[]> {
  const rows = await db
    .select({
      documentId: domainChecks.documentId,
      result: domainChecks.result,
      checkedAt: domainChecks.checkedAt,
      autoError: domainChecks.autoError,
      title: documents.title,
      companyId: documents.companyId,
      companyName: companies.name,
      docTypeName: docTypes.name,
    })
    .from(domainChecks)
    .innerJoin(documents, eq(documents.id, domainChecks.documentId))
    .innerJoin(companies, eq(companies.id, documents.companyId))
    .innerJoin(docTypes, eq(docTypes.id, documents.docTypeId))
    .where(
      and(
        isNull(documents.archivedAt),
        scopeWhere(scope, documents.companyId),
        isNotNull(domainChecks.checkedAt),
      ),
    )
    .orderBy(asc(documents.title))
    .limit(500);

  const items: DomainAttentionItem[] = [];
  for (const row of rows) {
    const result = row.result as DomainCheckResult | null;
    if (!result || !row.checkedAt) continue;

    const findings: Finding[] = [];
    for (const section of [result.dns, result.tls, result.rdap, result.email]) {
      if (!section) continue;
      if (!section.ok)
        findings.push({ severity: "bad", message: section.error });
      else
        findings.push(
          ...section.findings.filter((finding) => finding.severity !== "ok"),
        );
    }
    if (findings.length === 0 && !row.autoError) continue;

    items.push({
      documentId: row.documentId,
      title: row.title,
      companyId: row.companyId,
      companyName: row.companyName,
      docTypeName: row.docTypeName,
      domain: result.domain,
      checkedAt: row.checkedAt,
      findings,
      autoError: row.autoError,
    });
  }
  return items;
}

/** Letters and digits only, so "GoDaddy.com, LLC" can meet "GoDaddy". */
function squash(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * A dropdown stores an option id, and a lookup returns a name. An existing
 * option wins even when the wording differs — a registry saying
 * "GoDaddy.com, LLC" means the "GoDaddy" already in the list — and a name
 * nobody has listed is added to the shared list rather than refused.
 */
async function toStoredValue(
  fieldId: string,
  value: string,
  actorId: string,
): Promise<string> {
  const [field] = await db
    .select({ fieldType: fields.fieldType, optionListId: fields.optionListId })
    .from(fields)
    .where(eq(fields.id, fieldId))
    .limit(1);
  if (!field) throw new NoDomainFieldError();

  if (field.fieldType !== "dropdown" || !field.optionListId) return value;

  const listId = field.optionListId;
  const items = await db
    .select({ id: optionItems.id, label: optionItems.label })
    .from(optionItems)
    .where(and(eq(optionItems.listId, listId), isNull(optionItems.archivedAt)));

  const wanted = squash(value);
  const existing = items.find((item) => {
    const label = squash(item.label);
    return (
      label === wanted || label.startsWith(wanted) || wanted.startsWith(label)
    );
  });
  if (existing) return existing.id;

  const added = await addOptionItem(listId, { label: value }, actorId);
  return added.id;
}

/**
 * Writes one finding into the document it came from. This goes through the
 * ordinary save, so it earns a revision and an audit entry like any other
 * edit: a lookup never changes a record behind somebody's back.
 */
export async function applyDomainSuggestion(
  documentId: string,
  role: Exclude<DomainRole, "domain">,
  value: string,
  actorId: string,
  scope: CompanyScope,
): Promise<void> {
  const state = await getDomainCheckState(documentId, scope);
  const fieldId = state.targets[role];
  if (!fieldId) throw new NoDomainFieldError();

  const stored = await toStoredValue(fieldId, value, actorId);
  const saved = await saveDocument(
    documentId,
    { values: { [fieldId]: stored } },
    actorId,
    scope,
  );
  if (!saved.ok) {
    const [message] = Object.values(saved.errors);
    throw new SuggestionRejectedError(message ?? "That value was not accepted");
  }
}
