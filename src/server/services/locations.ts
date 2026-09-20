import "server-only";
import { z } from "zod";
import { and, asc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { documents, locations } from "@/server/db/schema";
import { writeAudit } from "@/server/services/audit";
import { queueEvent } from "@/server/services/webhooks";
import { NotFoundError } from "@/server/services/companies";
import { assertInScope, isInScope, type CompanyScope } from "@/server/auth/company-scope";

export const locationInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  address: z.string().trim().max(2_000).optional().nullable(),
});

export type LocationInput = z.infer<typeof locationInputSchema>;

export type LocationSummary = {
  id: string;
  name: string;
  address: string | null;
  archivedAt: Date | null;
  documentCount: number;
};

export async function listLocations(
  companyId: string,
  scope: CompanyScope,
  { includeArchived = false }: { includeArchived?: boolean } = {},
): Promise<LocationSummary[]> {
  assertInScope(scope, companyId);

  const documentCount = db
    .select({
      locationId: documents.locationId,
      n: sql<number>`count(*)::int`.as("document_count"),
    })
    .from(documents)
    .where(isNull(documents.archivedAt))
    .groupBy(documents.locationId)
    .as("location_document_counts");

  return db
    .select({
      id: locations.id,
      name: locations.name,
      address: locations.address,
      archivedAt: locations.archivedAt,
      documentCount: sql<number>`coalesce(${documentCount.n}, 0)`,
    })
    .from(locations)
    .leftJoin(documentCount, eq(documentCount.locationId, locations.id))
    .where(
      includeArchived
        ? eq(locations.companyId, companyId)
        : and(eq(locations.companyId, companyId), isNull(locations.archivedAt)),
    )
    .orderBy(asc(locations.name));
}

/** A location the caller may see, or null. Its company decides. */
export async function getLocation(id: string, scope: CompanyScope) {
  const [location] = await db.select().from(locations).where(eq(locations.id, id)).limit(1);
  if (!location || !isInScope(scope, location.companyId)) return null;
  return location;
}

export async function getLocationOrThrow(id: string, scope: CompanyScope) {
  const location = await getLocation(id, scope);
  if (!location) throw new NotFoundError("Location");
  return location;
}

export async function createLocation(
  companyId: string,
  input: LocationInput,
  actorId: string | null,
  scope: CompanyScope,
): Promise<{ id: string }> {
  assertInScope(scope, companyId);
  const data = locationInputSchema.parse(input);

  return db.transaction(async (tx) => {
    const [location] = await tx
      .insert(locations)
      .values({ companyId, name: data.name, address: data.address ?? null })
      .returning({ id: locations.id });
    if (!location) throw new Error("Failed to create location");

    await writeAudit(
      {
        userId: actorId,
        action: "location.created",
        entity: "location",
        entityId: location.id,
        detail: { companyId, name: data.name },
      },
      tx,
    );

    await queueEvent(
      "location.created",
      { id: location.id, company_id: companyId, name: data.name, address: data.address ?? null },
      tx,
    );

    return location;
  });
}

export async function updateLocation(
  id: string,
  input: LocationInput,
  actorId: string | null,
  scope: CompanyScope,
): Promise<void> {
  // Resolving it first is the scope check: out of scope throws "not found".
  await getLocationOrThrow(id, scope);
  const data = locationInputSchema.parse(input);

  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(locations)
      .set({ name: data.name, address: data.address ?? null })
      .where(eq(locations.id, id))
      .returning({ id: locations.id });
    if (!updated) throw new NotFoundError("Location");

    await writeAudit(
      {
        userId: actorId,
        action: "location.updated",
        entity: "location",
        entityId: id,
        detail: { name: data.name },
      },
      tx,
    );

    await queueEvent(
      "location.updated",
      { id, name: data.name, address: data.address ?? null },
      tx,
    );
  });
}

export async function archiveLocation(
  id: string,
  actorId: string,
  scope: CompanyScope,
): Promise<void> {
  await getLocationOrThrow(id, scope);
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(locations)
      .set({ archivedAt: new Date() })
      .where(and(eq(locations.id, id), isNull(locations.archivedAt)))
      .returning({ id: locations.id });
    if (!updated) throw new NotFoundError("Active location");

    await writeAudit(
      { userId: actorId, action: "location.archived", entity: "location", entityId: id },
      tx,
    );
  });
}

export async function unarchiveLocation(
  id: string,
  actorId: string,
  scope: CompanyScope,
): Promise<void> {
  await getLocationOrThrow(id, scope);
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(locations)
      .set({ archivedAt: null })
      .where(eq(locations.id, id))
      .returning({ id: locations.id });
    if (!updated) throw new NotFoundError("Location");

    await writeAudit(
      { userId: actorId, action: "location.unarchived", entity: "location", entityId: id },
      tx,
    );
  });
}

/** Keyset page ordered by (name, id), for GET /api/v1/companies/:id/locations. */
export async function listLocationsPage(input: {
  companyId: string;
  limit: number;
  cursor: { sort: string; id: string } | null;
  scope: CompanyScope;
}) {
  assertInScope(input.scope, input.companyId);
  const filters = [eq(locations.companyId, input.companyId), isNull(locations.archivedAt)];
  if (input.cursor) {
    filters.push(
      or(
        gt(locations.name, input.cursor.sort),
        and(eq(locations.name, input.cursor.sort), gt(locations.id, input.cursor.id)),
      ) as ReturnType<typeof isNull>,
    );
  }

  return db
    .select()
    .from(locations)
    .where(and(...filters))
    .orderBy(asc(locations.name), asc(locations.id))
    .limit(input.limit + 1);
}
