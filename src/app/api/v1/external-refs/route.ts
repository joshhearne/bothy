import { json, readJson, withApi } from "@/server/api/http";
import { upsertExternalRef } from "@/server/services/external-refs";

export const dynamic = "force-dynamic";

/** Upsert on (system, entity, external_id). */
export const PUT = withApi("write", async ({ request }) => {
  const body = await readJson(request);
  const row = await upsertExternalRef(
    {
      entity: body.entity as "company",
      entity_id: body.entity_id as string,
      system: body.system as string,
      external_id: body.external_id as string,
    },
    null,
  );

  return json({
    id: row.id,
    entity: row.entity,
    entity_id: row.entityId,
    system: row.system,
    external_id: row.externalId,
  });
});
