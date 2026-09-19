import "server-only";
import { z } from "zod";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db";
import {
  docTypes,
  documentRevisions,
  documents,
  fields,
  locations,
} from "@/server/db/schema";
import { writeAudit } from "@/server/services/audit";
import { NotFoundError } from "@/server/services/companies";
import { listTemplateFields } from "@/server/services/doc-types";
import { loadOptionIndex, loadOptionLabels } from "@/server/services/option-lists";
import type { FieldDefinition } from "@/server/fields/types";
import {
  flattenForSearch,
  mergeFieldValues,
  validateFieldValues,
  type OptionIndex,
} from "@/server/fields/values";

export type DocumentListItem = {
  id: string;
  title: string;
  updatedAt: Date;
  docTypeId: string;
  docTypeName: string;
  docTypeIcon: string | null;
  docTypeScope: string;
  locationId: string | null;
  locationName: string | null;
};

export type DocumentGroup = {
  docType: { id: string; name: string; icon: string | null; scope: string };
  documents: DocumentListItem[];
};

/** Active documents belonging to a company, with their doc type and location joined. */
export async function listCompanyDocuments(companyId: string): Promise<DocumentListItem[]> {
  return db
    .select({
      id: documents.id,
      title: documents.title,
      updatedAt: documents.updatedAt,
      docTypeId: docTypes.id,
      docTypeName: docTypes.name,
      docTypeIcon: docTypes.icon,
      docTypeScope: docTypes.scope,
      locationId: locations.id,
      locationName: locations.name,
    })
    .from(documents)
    .innerJoin(docTypes, eq(docTypes.id, documents.docTypeId))
    .leftJoin(locations, eq(locations.id, documents.locationId))
    .where(and(eq(documents.companyId, companyId), isNull(documents.archivedAt)))
    .orderBy(asc(docTypes.name), asc(documents.title));
}

/**
 * Groups documents under their doc type, preserving the order they arrive in.
 * Pure so the company page's shape can be tested without a database.
 */
export function groupByDocType(rows: DocumentListItem[]): DocumentGroup[] {
  const groups = new Map<string, DocumentGroup>();

  for (const row of rows) {
    let group = groups.get(row.docTypeId);
    if (!group) {
      group = {
        docType: {
          id: row.docTypeId,
          name: row.docTypeName,
          icon: row.docTypeIcon,
          scope: row.docTypeScope,
        },
        documents: [],
      };
      groups.set(row.docTypeId, group);
    }
    group.documents.push(row);
  }

  return [...groups.values()];
}

export async function listCompanyDocumentsGrouped(companyId: string): Promise<DocumentGroup[]> {
  return groupByDocType(await listCompanyDocuments(companyId));
}

/**
 * Template fields first, then the document's own local fields, with an explicit
 * `field_order` winning when the document has one (ARCHITECTURE, inline editing
 * rule 1). Unknown ids in `field_order` are ignored; fields missing from it keep
 * their natural position at the end.
 */
export function orderFields(
  templateFields: FieldDefinition[],
  localFields: FieldDefinition[],
  fieldOrder: string[] | null,
): FieldDefinition[] {
  const natural = [...templateFields, ...localFields];
  if (!fieldOrder || fieldOrder.length === 0) return natural;

  const byId = new Map(natural.map((field) => [field.id, field]));
  const ordered: FieldDefinition[] = [];

  for (const id of fieldOrder) {
    const field = byId.get(id);
    if (field) {
      ordered.push(field);
      byId.delete(id);
    }
  }
  for (const field of natural) {
    if (byId.has(field.id)) ordered.push(field);
  }

  return ordered;
}

async function listLocalFields(
  documentId: string,
  { includeArchived = false }: { includeArchived?: boolean } = {},
): Promise<FieldDefinition[]> {
  return db
    .select({
      id: fields.id,
      label: fields.label,
      fieldType: fields.fieldType,
      optionListId: fields.optionListId,
      required: fields.required,
      sortOrder: fields.sortOrder,
      archivedAt: fields.archivedAt,
      docTypeId: fields.docTypeId,
      documentId: fields.documentId,
    })
    .from(fields)
    .where(
      includeArchived
        ? eq(fields.documentId, documentId)
        : and(eq(fields.documentId, documentId), isNull(fields.archivedAt)),
    )
    .orderBy(asc(fields.sortOrder), asc(fields.label)) as Promise<FieldDefinition[]>;
}

export type DocumentDetail = {
  document: typeof documents.$inferSelect;
  docType: typeof docTypes.$inferSelect;
  location: { id: string; name: string } | null;
  fields: FieldDefinition[];
  optionIndex: OptionIndex;
  /** Every option label, archived included, so stored values still render. */
  optionLabels: Map<string, string>;
};

export async function getDocumentDetail(id: string): Promise<DocumentDetail | null> {
  const [row] = await db
    .select({ document: documents, docType: docTypes })
    .from(documents)
    .innerJoin(docTypes, eq(docTypes.id, documents.docTypeId))
    .where(eq(documents.id, id))
    .limit(1);
  if (!row) return null;

  const [templateFields, localFields] = await Promise.all([
    listTemplateFields(row.docType.id),
    listLocalFields(id),
  ]);

  const ordered = orderFields(templateFields, localFields, row.document.fieldOrder ?? null);
  const listIds = ordered.flatMap((field) => (field.optionListId ? [field.optionListId] : []));

  const [optionIndex, optionLabels, location] = await Promise.all([
    loadOptionIndex(listIds),
    loadOptionLabels(listIds),
    row.document.locationId
      ? db
          .select({ id: locations.id, name: locations.name })
          .from(locations)
          .where(eq(locations.id, row.document.locationId))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
  ]);

  return {
    document: row.document,
    docType: row.docType,
    location,
    fields: ordered,
    optionIndex,
    optionLabels,
  };
}

export const documentInputSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(300),
});

export class ScopeMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScopeMismatchError";
  }
}

export type SaveResult = { ok: true; id: string } | { ok: false; errors: Record<string, string> };

/**
 * A company-scoped doc type takes no location; a location-scoped one requires a
 * location belonging to the same company.
 */
async function assertScope(
  docTypeId: string,
  companyId: string,
  locationId: string | null,
): Promise<void> {
  const [docType] = await db
    .select({ scope: docTypes.scope, name: docTypes.name })
    .from(docTypes)
    .where(eq(docTypes.id, docTypeId))
    .limit(1);
  if (!docType) throw new NotFoundError("Doc type");

  if (docType.scope === "company") {
    if (locationId) throw new ScopeMismatchError(`${docType.name} documents attach to the company`);
    return;
  }

  if (!locationId) throw new ScopeMismatchError(`${docType.name} documents need a location`);

  const [location] = await db
    .select({ companyId: locations.companyId })
    .from(locations)
    .where(eq(locations.id, locationId))
    .limit(1);
  if (!location) throw new NotFoundError("Location");
  if (location.companyId !== companyId) {
    throw new ScopeMismatchError("That location belongs to another company");
  }
}

export async function createDocument(
  input: {
    companyId: string;
    docTypeId: string;
    locationId: string | null;
    title: string;
    values?: Record<string, unknown>;
  },
  actorId: string,
): Promise<SaveResult> {
  const { title } = documentInputSchema.parse({ title: input.title });
  await assertScope(input.docTypeId, input.companyId, input.locationId);

  const templateFields = await listTemplateFields(input.docTypeId);
  const optionIndex = await loadOptionIndex(
    templateFields.flatMap((field) => (field.optionListId ? [field.optionListId] : [])),
  );

  const raw = input.values ?? {};
  // A new document must satisfy every required field, so treat absent as blank.
  const submitted: Record<string, unknown> = {};
  for (const field of templateFields) submitted[field.id] = raw[field.id] ?? null;

  const { values, errors } = validateFieldValues(templateFields, submitted, optionIndex);
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const fieldValues = mergeFieldValues({}, values);
  const searchText = flattenForSearch(templateFields, fieldValues, optionIndex);

  const id = await db.transaction(async (tx) => {
    const [document] = await tx
      .insert(documents)
      .values({
        docTypeId: input.docTypeId,
        companyId: input.companyId,
        locationId: input.locationId,
        title,
        fieldValues,
        searchText,
        updatedBy: actorId,
      })
      .returning({ id: documents.id });
    if (!document) throw new Error("Failed to create document");

    await tx.insert(documentRevisions).values({
      documentId: document.id,
      title,
      fieldValues,
      editedBy: actorId,
    });

    await writeAudit(
      {
        userId: actorId,
        action: "document.created",
        entity: "document",
        entityId: document.id,
        detail: { companyId: input.companyId, docTypeId: input.docTypeId, title },
      },
      tx,
    );

    return document.id;
  });

  return { ok: true, id };
}

/**
 * Applies a partial map of raw field values, keyed by field UUID, to a document.
 * One transaction writes the document, a revision of the resulting version, and
 * an audit entry — the three things CLAUDE.md requires of every save.
 */
export async function saveDocument(
  id: string,
  input: { title?: string; values?: Record<string, unknown> },
  actorId: string,
): Promise<SaveResult> {
  const detail = await getDocumentDetail(id);
  if (!detail) throw new NotFoundError("Document");

  const errors: Record<string, string> = {};

  let title = detail.document.title;
  if (input.title !== undefined) {
    const parsed = documentInputSchema.safeParse({ title: input.title });
    if (parsed.success) title = parsed.data.title;
    else errors["title"] = parsed.error.issues[0]?.message ?? "Invalid title";
  }

  const validated = validateFieldValues(detail.fields, input.values ?? {}, detail.optionIndex);
  Object.assign(errors, validated.errors);
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const fieldValues = mergeFieldValues(
    detail.document.fieldValues ?? {},
    validated.values,
  );
  const searchText = flattenForSearch(detail.fields, fieldValues, detail.optionIndex);

  await db.transaction(async (tx) => {
    await tx
      .update(documents)
      .set({ title, fieldValues, searchText, updatedBy: actorId, updatedAt: new Date() })
      .where(eq(documents.id, id));

    await tx.insert(documentRevisions).values({
      documentId: id,
      title,
      fieldValues,
      editedBy: actorId,
    });

    await writeAudit(
      {
        userId: actorId,
        action: "document.updated",
        entity: "document",
        entityId: id,
        detail: { title, changedFields: Object.keys(validated.values) },
      },
      tx,
    );
  });

  return { ok: true, id };
}

export async function archiveDocument(id: string, actorId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(documents)
      .set({ archivedAt: new Date() })
      .where(and(eq(documents.id, id), isNull(documents.archivedAt)))
      .returning({ id: documents.id });
    if (!updated) throw new NotFoundError("Active document");

    await writeAudit(
      { userId: actorId, action: "document.archived", entity: "document", entityId: id },
      tx,
    );
  });
}

export async function unarchiveDocument(id: string, actorId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(documents)
      .set({ archivedAt: null })
      .where(eq(documents.id, id))
      .returning({ id: documents.id });
    if (!updated) throw new NotFoundError("Document");

    await writeAudit(
      { userId: actorId, action: "document.unarchived", entity: "document", entityId: id },
      tx,
    );
  });
}

export type RevisionRow = {
  id: number;
  title: string;
  fieldValues: Record<string, unknown>;
  createdAt: Date;
  editedBy: string | null;
};

/** Newest first. Each row is the state the document was left in by that save. */
export async function listRevisions(documentId: string, limit = 50): Promise<RevisionRow[]> {
  return db
    .select({
      id: documentRevisions.id,
      title: documentRevisions.title,
      fieldValues: documentRevisions.fieldValues,
      createdAt: documentRevisions.createdAt,
      editedBy: documentRevisions.editedBy,
    })
    .from(documentRevisions)
    .where(eq(documentRevisions.documentId, documentId))
    .orderBy(desc(documentRevisions.id))
    .limit(limit);
}

/** Doc types a company can hold documents of, split by scope. */
export async function listUsableDocTypes(hasLocations: boolean) {
  return db
    .select({ id: docTypes.id, name: docTypes.name, scope: docTypes.scope, icon: docTypes.icon })
    .from(docTypes)
    .where(
      hasLocations
        ? isNull(docTypes.archivedAt)
        : and(isNull(docTypes.archivedAt), eq(docTypes.scope, "company")),
    )
    .orderBy(asc(docTypes.name));
}
