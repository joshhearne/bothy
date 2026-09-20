import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db";
import { documents, domainChecks, fields } from "@/server/db/schema";
import { writeAudit } from "@/server/services/audit";
import { NotFoundError } from "@/server/services/errors";
import { assertDocumentInScope, saveDocument } from "@/server/services/documents";
import type { CompanyScope } from "@/server/auth/company-scope";
import { optionItems } from "@/server/db/schema";
import { addOptionItem } from "@/server/services/option-lists";
import { normalizeDomain } from "@/server/domain/hostname";
import { runChecks, type CheckSelection, type DomainCheckResult } from "@/server/domain/run";

/**
 * Domain checks for one document: which lookups it runs, what the last run
 * found, and the fields a result may offer to fill in.
 *
 * A document can run checks when its doc type has a field marked as holding a
 * domain, so this is not wired to one doc type's labels: an operator can point
 * it at a field on a doc type of their own.
 */

export type DomainRole = "domain" | "expiry" | "registrar" | "dns_host";

export type DomainCheckState = {
  /** Null when this doc type has no field marked as a domain. */
  domain: string | null;
  /** What was typed, when it is not a domain we can look up. */
  rawDomain: string | null;
  selection: CheckSelection;
  result: DomainCheckResult | null;
  checkedAt: Date | null;
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

async function roleFields(documentId: string): Promise<{
  docTypeId: string;
  targets: Partial<Record<DomainRole, string>>;
}> {
  const [document] = await db
    .select({ docTypeId: documents.docTypeId })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);
  if (!document) throw new NotFoundError("Document");

  const rows = await db
    .select({ id: fields.id, role: fields.domainRole })
    .from(fields)
    .where(and(eq(fields.docTypeId, document.docTypeId), isNull(fields.archivedAt)));

  const targets: Partial<Record<DomainRole, string>> = {};
  for (const row of rows) {
    if (row.role) targets[row.role as DomainRole] = row.id;
  }
  return { docTypeId: document.docTypeId, targets };
}

export async function getDomainCheckState(
  documentId: string,
  scope: CompanyScope,
): Promise<DomainCheckState> {
  await assertDocumentInScope(documentId, scope);

  const { targets } = await roleFields(documentId);
  const [row] = await db
    .select()
    .from(domainChecks)
    .where(eq(domainChecks.documentId, documentId))
    .limit(1);

  const selection: CheckSelection = {
    dns: row?.dns ?? false,
    tls: row?.tls ?? false,
    rdap: row?.rdap ?? false,
    email: row?.email ?? false,
  };

  const domainFieldId = targets.domain;
  if (!domainFieldId) {
    return { domain: null, rawDomain: null, selection, result: null, checkedAt: null, targets };
  }

  const [document] = await db
    .select({ values: documents.fieldValues })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);

  const raw = (document?.values as Record<string, unknown> | null)?.[domainFieldId];
  const rawDomain = typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;

  return {
    domain: rawDomain ? normalizeDomain(rawDomain) : null,
    rawDomain,
    selection,
    result: (row?.result as DomainCheckResult | null) ?? null,
    checkedAt: row?.checkedAt ?? null,
    targets,
  };
}

export async function setDomainChecks(
  documentId: string,
  selection: CheckSelection,
  actorId: string,
  scope: CompanyScope,
): Promise<void> {
  await assertDocumentInScope(documentId, scope);

  await db
    .insert(domainChecks)
    .values({ documentId, ...selection })
    .onConflictDoUpdate({ target: domainChecks.documentId, set: selection });
}

/** Runs the enabled checks and keeps the result, so a page view costs nothing. */
export async function runDomainCheck(
  documentId: string,
  actorId: string,
  scope: CompanyScope,
): Promise<DomainCheckResult> {
  const state = await getDomainCheckState(documentId, scope);
  if (!state.targets.domain) throw new NoDomainFieldError();
  if (!state.domain) throw new NotADomainError();
  if (!takeToken()) throw new TooManyChecksError();

  const selection = state.selection;
  const anything = selection.dns || selection.tls || selection.rdap || selection.email;
  const result = await runChecks(
    state.domain,
    anything ? selection : { dns: true, tls: true, rdap: false, email: false },
  );

  await db.transaction(async (tx) => {
    await tx
      .insert(domainChecks)
      .values({
        documentId,
        ...selection,
        result,
        checkedAt: new Date(),
        checkedBy: actorId,
      })
      .onConflictDoUpdate({
        target: domainChecks.documentId,
        set: { result, checkedAt: new Date(), checkedBy: actorId },
      });

    await writeAudit(
      {
        userId: actorId,
        action: "domain.checked",
        entity: "document",
        entityId: documentId,
        detail: { domain: state.domain, checks: selection },
      },
      tx,
    );
  });

  return result;
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
    return label === wanted || label.startsWith(wanted) || wanted.startsWith(label);
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
  const saved = await saveDocument(documentId, { values: { [fieldId]: stored } }, actorId, scope);
  if (!saved.ok) {
    const [message] = Object.values(saved.errors);
    throw new SuggestionRejectedError(message ?? "That value was not accepted");
  }
}
