import "server-only";
import { z } from "zod";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { documents, locations } from "@/server/db/schema";
import { writeAudit } from "@/server/services/audit";
import { NotFoundError } from "@/server/services/companies";

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
  { includeArchived = false }: { includeArchived?: boolean } = {},
): Promise<LocationSummary[]> {
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

export async function getLocation(id: string) {
  const [location] = await db.select().from(locations).where(eq(locations.id, id)).limit(1);
  return location ?? null;
}

export async function getLocationOrThrow(id: string) {
  const location = await getLocation(id);
  if (!location) throw new NotFoundError("Location");
  return location;
}

export async function createLocation(
  companyId: string,
  input: LocationInput,
  actorId: string,
): Promise<{ id: string }> {
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

    return location;
  });
}

export async function updateLocation(
  id: string,
  input: LocationInput,
  actorId: string,
): Promise<void> {
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
  });
}

export async function archiveLocation(id: string, actorId: string): Promise<void> {
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

export async function unarchiveLocation(id: string, actorId: string): Promise<void> {
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
