import "server-only";
import { z } from "zod";
import { and, asc, eq, gt, ilike, isNull, or, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { companies, documents, locations } from "@/server/db/schema";
import { writeAudit } from "@/server/services/audit";
import { queueEvent } from "@/server/services/webhooks";
import { ForbiddenError, NotFoundError } from "@/server/services/errors";
import {
  assertInScope,
  isInScope,
  scopeWhere,
  type CompanyScope,
} from "@/server/auth/company-scope";

export const companyInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  isInternal: z.boolean().default(false),
  notes: z.string().trim().max(20_000).optional().nullable(),
});

export type CompanyInput = z.infer<typeof companyInputSchema>;

export type CompanySummary = {
  id: string;
  name: string;
  isInternal: boolean;
  archivedAt: Date | null;
  locationCount: number;
  documentCount: number;
};

// Re-exported: callers have imported it from here since phase 1.
export { NotFoundError };

/** Companies with their live location and document counts, internal org first. */
export async function listCompanies(
  scope: CompanyScope,
  { includeArchived = false }: { includeArchived?: boolean } = {},
): Promise<CompanySummary[]> {
  const locationCount = db
    .select({
      companyId: locations.companyId,
      n: sql<number>`count(*)::int`.as("location_count"),
    })
    .from(locations)
    .where(isNull(locations.archivedAt))
    .groupBy(locations.companyId)
    .as("location_counts");

  const documentCount = db
    .select({
      companyId: documents.companyId,
      n: sql<number>`count(*)::int`.as("document_count"),
    })
    .from(documents)
    .where(isNull(documents.archivedAt))
    .groupBy(documents.companyId)
    .as("document_counts");

  return db
    .select({
      id: companies.id,
      name: companies.name,
      isInternal: companies.isInternal,
      archivedAt: companies.archivedAt,
      locationCount: sql<number>`coalesce(${locationCount.n}, 0)`,
      documentCount: sql<number>`coalesce(${documentCount.n}, 0)`,
    })
    .from(companies)
    .leftJoin(locationCount, eq(locationCount.companyId, companies.id))
    .leftJoin(documentCount, eq(documentCount.companyId, companies.id))
    .where(and(includeArchived ? undefined : isNull(companies.archivedAt), scopeWhere(scope, companies.id)))
    .orderBy(sql`${companies.isInternal} desc`, asc(companies.name));
}

/** A company the caller may see, or null. Out of scope reads as absent. */
export async function getCompany(id: string, scope: CompanyScope) {
  const [company] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
  if (!company || !isInScope(scope, company.id)) return null;
  return company;
}

export async function getCompanyOrThrow(id: string, scope: CompanyScope) {
  const company = await getCompany(id, scope);
  if (!company) throw new NotFoundError("Company");
  return company;
}

export async function createCompany(
  input: CompanyInput,
  actorId: string | null,
  scope: CompanyScope,
): Promise<{ id: string }> {
  // A principal limited to named companies cannot mint one it would then be
  // unable to see. Refusing is clearer than creating something invisible.
  if (!scope.all) {
    throw new ForbiddenError("This principal is limited to specific companies");
  }
  const data = companyInputSchema.parse(input);

  return db.transaction(async (tx) => {
    const [company] = await tx
      .insert(companies)
      .values({ name: data.name, isInternal: data.isInternal, notes: data.notes ?? null })
      .returning({ id: companies.id });
    if (!company) throw new Error("Failed to create company");

    await writeAudit(
      {
        userId: actorId,
        action: "company.created",
        entity: "company",
        entityId: company.id,
        detail: { name: data.name },
      },
      tx,
    );

    await queueEvent(
      "company.created",
      { id: company.id, name: data.name, is_internal: data.isInternal },
      tx,
    );

    return company;
  });
}

export async function updateCompany(
  id: string,
  input: CompanyInput,
  actorId: string | null,
  scope: CompanyScope,
): Promise<void> {
  assertInScope(scope, id);
  const data = companyInputSchema.parse(input);

  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(companies)
      .set({ name: data.name, isInternal: data.isInternal, notes: data.notes ?? null })
      .where(eq(companies.id, id))
      .returning({ id: companies.id });
    if (!updated) throw new NotFoundError("Company");

    await writeAudit(
      {
        userId: actorId,
        action: "company.updated",
        entity: "company",
        entityId: id,
        detail: { name: data.name },
      },
      tx,
    );

    await queueEvent("company.updated", { id, name: data.name, is_internal: data.isInternal }, tx);
  });
}

/** Archive, never hard delete (CLAUDE.md). Archiving a company hides its locations too. */
export async function archiveCompany(
  id: string,
  actorId: string,
  scope: CompanyScope,
): Promise<void> {
  assertInScope(scope, id);
  const at = new Date();

  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(companies)
      .set({ archivedAt: at })
      .where(and(eq(companies.id, id), isNull(companies.archivedAt)))
      .returning({ id: companies.id });
    if (!updated) throw new NotFoundError("Active company");

    await tx
      .update(locations)
      .set({ archivedAt: at })
      .where(and(eq(locations.companyId, id), isNull(locations.archivedAt)));

    await writeAudit(
      { userId: actorId, action: "company.archived", entity: "company", entityId: id },
      tx,
    );
  });
}

export async function unarchiveCompany(
  id: string,
  actorId: string,
  scope: CompanyScope,
): Promise<void> {
  assertInScope(scope, id);
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(companies)
      .set({ archivedAt: null })
      .where(eq(companies.id, id))
      .returning({ id: companies.id });
    if (!updated) throw new NotFoundError("Company");

    await writeAudit(
      { userId: actorId, action: "company.unarchived", entity: "company", entityId: id },
      tx,
    );
  });
}

export type CompanyPageInput = {
  q?: string | undefined;
  limit: number;
  cursor: { sort: string; id: string } | null;
  scope: CompanyScope;
};

/** Keyset page ordered by (name, id), for GET /api/v1/companies. */
export async function listCompaniesPage(input: CompanyPageInput) {
  const filters = [isNull(companies.archivedAt)];
  const scoped = scopeWhere(input.scope, companies.id);
  if (scoped) filters.push(scoped);
  if (input.q) filters.push(ilike(companies.name, `%${input.q}%`));
  if (input.cursor) {
    filters.push(
      or(
        gt(companies.name, input.cursor.sort),
        and(eq(companies.name, input.cursor.sort), gt(companies.id, input.cursor.id)),
      ) as ReturnType<typeof isNull>,
    );
  }

  return db
    .select()
    .from(companies)
    .where(and(...filters))
    .orderBy(asc(companies.name), asc(companies.id))
    .limit(input.limit + 1);
}
