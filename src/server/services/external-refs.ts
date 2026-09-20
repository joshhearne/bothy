import "server-only";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, type Executor } from "@/server/db";
import { documents, externalRefs, locations } from "@/server/db/schema";
import { writeAudit } from "@/server/services/audit";
import { assertInScope, isInScope, type CompanyScope } from "@/server/auth/company-scope";
import { NotFoundError } from "@/server/services/errors";

/**
 * Maps Bothy records to ids in any external system, so a ticket in a PSA can
 * find "its" company. See docs/API.md, PSA integration endpoints.
 */

export const EXTERNAL_ENTITIES = ["company", "location", "document"] as const;
export type ExternalEntity = (typeof EXTERNAL_ENTITIES)[number];

export const externalRefInputSchema = z.object({
  entity: z.enum(EXTERNAL_ENTITIES),
  entity_id: z.uuid(),
  system: z.string().trim().min(1, "system is required").max(100),
  external_id: z.string().trim().min(1, "external_id is required").max(200),
});

export type ExternalRefInput = z.infer<typeof externalRefInputSchema>;

export type ExternalRefRow = {
  id: string;
  entity: string;
  entityId: string;
  system: string;
  externalId: string;
};

/**
 * The company a mapped record belongs to. Every entity an external ref may
 * name hangs off exactly one company, which is what decides who may map it.
 */
async function companyOf(entity: ExternalEntity, entityId: string): Promise<string | null> {
  if (entity === "company") return entityId;

  if (entity === "location") {
    const [row] = await db
      .select({ companyId: locations.companyId })
      .from(locations)
      .where(eq(locations.id, entityId))
      .limit(1);
    return row?.companyId ?? null;
  }

  const [row] = await db
    .select({ companyId: documents.companyId })
    .from(documents)
    .where(eq(documents.id, entityId))
    .limit(1);
  return row?.companyId ?? null;
}

/** Upsert on (system, entity, external_id), which is the table's unique key. */
export async function upsertExternalRef(
  input: z.input<typeof externalRefInputSchema>,
  actorId: string | null,
  scope: CompanyScope,
  tx?: Executor,
): Promise<ExternalRefRow> {
  const data = externalRefInputSchema.parse(input);

  const companyId = await companyOf(data.entity, data.entity_id);
  if (!companyId) throw new NotFoundError("Record");
  assertInScope(scope, companyId, "Record");

  const exec = tx ?? db;

  const [row] = await exec
    .insert(externalRefs)
    .values({
      entity: data.entity,
      entityId: data.entity_id,
      system: data.system,
      externalId: data.external_id,
    })
    .onConflictDoUpdate({
      target: [externalRefs.system, externalRefs.entity, externalRefs.externalId],
      set: { entityId: data.entity_id },
    })
    .returning({
      id: externalRefs.id,
      entity: externalRefs.entity,
      entityId: externalRefs.entityId,
      system: externalRefs.system,
      externalId: externalRefs.externalId,
    });
  if (!row) throw new Error("Failed to record external reference");

  await writeAudit(
    {
      userId: actorId,
      action: "external_ref.upserted",
      entity: data.entity,
      entityId: data.entity_id,
      detail: { system: data.system, externalId: data.external_id },
    },
    exec,
  );

  return row;
}

export async function listExternalRefs(
  entity: ExternalEntity,
  entityId: string,
): Promise<ExternalRefRow[]> {
  return db
    .select({
      id: externalRefs.id,
      entity: externalRefs.entity,
      entityId: externalRefs.entityId,
      system: externalRefs.system,
      externalId: externalRefs.externalId,
    })
    .from(externalRefs)
    .where(and(eq(externalRefs.entity, entity), eq(externalRefs.entityId, entityId)));
}

/**
 * Resolves an external id back to the Bothy record it names, or null when the
 * caller may not see that record — the same answer an unmapped id gets, so a
 * deep link cannot be used to probe for companies.
 */
export async function resolveExternalRef(
  system: string,
  entity: ExternalEntity,
  externalId: string,
  scope: CompanyScope,
): Promise<string | null> {
  const [row] = await db
    .select({ entityId: externalRefs.entityId })
    .from(externalRefs)
    .where(
      and(
        eq(externalRefs.system, system),
        eq(externalRefs.entity, entity),
        eq(externalRefs.externalId, externalId),
      ),
    )
    .limit(1);
  if (!row) return null;

  const companyId = await companyOf(entity, row.entityId);
  if (!companyId || !isInScope(scope, companyId)) return null;
  return row.entityId;
}

/** External ids for a set of records, for embedding in API responses. */
export async function loadExternalRefMap(
  entity: ExternalEntity,
  entityIds: string[],
): Promise<Map<string, { system: string; external_id: string }[]>> {
  const map = new Map<string, { system: string; external_id: string }[]>();
  if (entityIds.length === 0) return map;

  const rows = await db
    .select({
      entityId: externalRefs.entityId,
      system: externalRefs.system,
      externalId: externalRefs.externalId,
    })
    .from(externalRefs)
    .where(eq(externalRefs.entity, entity));

  const wanted = new Set(entityIds);
  for (const row of rows) {
    if (!wanted.has(row.entityId)) continue;
    const list = map.get(row.entityId) ?? [];
    list.push({ system: row.system, external_id: row.externalId });
    map.set(row.entityId, list);
  }
  return map;
}

/** Removes one mapping. Used by the company to collection mapping screen. */
export async function removeExternalRef(
  id: string,
  actorId: string | null,
  scope: CompanyScope,
): Promise<void> {
  const [existing] = await db
    .select({ entity: externalRefs.entity, entityId: externalRefs.entityId })
    .from(externalRefs)
    .where(eq(externalRefs.id, id))
    .limit(1);
  if (!existing) return;

  const companyId = await companyOf(existing.entity as ExternalEntity, existing.entityId);
  if (!companyId) throw new NotFoundError("Record");
  assertInScope(scope, companyId, "Record");

  await db.transaction(async (tx) => {
    const [row] = await tx
      .delete(externalRefs)
      .where(eq(externalRefs.id, id))
      .returning({ entity: externalRefs.entity, entityId: externalRefs.entityId });
    if (!row) return;

    await writeAudit(
      {
        userId: actorId,
        action: "external_ref.removed",
        entity: row.entity,
        entityId: row.entityId,
        detail: { refId: id },
      },
      tx,
    );
  });
}

/** Mappings for one system, e.g. the Bitwarden collections of a company. */
export async function listRefsForSystem(
  entity: ExternalEntity,
  entityId: string,
  system: string,
): Promise<ExternalRefRow[]> {
  const rows = await listExternalRefs(entity, entityId);
  return rows.filter((row) => row.system === system);
}
