import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db";
import { docTypes, documents, locations } from "@/server/db/schema";

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
