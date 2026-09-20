import { apiError, json, withApi } from "@/server/api/http";
import { serializeCompany, serializeLocation } from "@/server/api/serializers";
import { getCompany } from "@/server/services/companies";
import { listLocations } from "@/server/services/locations";
import { listCompanyDocuments } from "@/server/services/documents";
import {
  EXTERNAL_ENTITIES,
  loadExternalRefMap,
  resolveExternalRef,
  type ExternalEntity,
} from "@/server/services/external-refs";

export const dynamic = "force-dynamic";

/**
 * The main PSA call: given a ticket's company id in their system, return the
 * company with its locations and a document summary.
 */
export const GET = withApi("read", async ({ url, scope }) => {
  const system = url.searchParams.get("system");
  const entityParam = url.searchParams.get("entity") ?? "company";
  const externalId = url.searchParams.get("external_id");

  if (!system || !externalId) {
    return apiError(422, "invalid_request", "system and external_id are required");
  }
  if (!(EXTERNAL_ENTITIES as readonly string[]).includes(entityParam)) {
    return apiError(422, "invalid_request", `entity must be one of ${EXTERNAL_ENTITIES.join(", ")}`);
  }

  const entity = entityParam as ExternalEntity;
  const entityId = await resolveExternalRef(system, entity, externalId, scope);
  if (!entityId) return apiError(404, "not_found", "Nothing is mapped to that external id");

  if (entity !== "company") {
    return json({ entity, entity_id: entityId });
  }

  const company = await getCompany(entityId, scope);
  if (!company) return apiError(404, "not_found", "That company no longer exists");

  const [locations, documents, refs] = await Promise.all([
    listLocations(company.id, scope),
    listCompanyDocuments(company.id, scope),
    loadExternalRefMap("company", [company.id]),
  ]);

  return json({
    company: serializeCompany(company, refs.get(company.id) ?? []),
    locations: locations.map((location) =>
      serializeLocation({ ...location, companyId: company.id }),
    ),
    documents: documents.map((document) => ({
      id: document.id,
      title: document.title,
      doc_type: { id: document.docTypeId, name: document.docTypeName },
      location_name: document.locationName,
      updated_at: document.updatedAt.toISOString(),
    })),
  });
});
