import { apiError, json, readJson, withApi } from "@/server/api/http";
import { serializeDocument } from "@/server/api/serializers";
import { loadExternalRefMap } from "@/server/services/external-refs";
import { createDocument, getDocumentDetail } from "@/server/services/documents";
import { NotFoundError } from "@/server/services/companies";

export const dynamic = "force-dynamic";

export const POST = withApi("write", async ({ request, scope }) => {
  const body = await readJson(request);

  if (typeof body.company_id !== "string" || typeof body.doc_type_id !== "string") {
    return apiError(422, "invalid_request", "company_id and doc_type_id are required");
  }

  const result = await createDocument(
    {
      companyId: body.company_id,
      docTypeId: body.doc_type_id,
      locationId: typeof body.location_id === "string" ? body.location_id : null,
      title: typeof body.title === "string" ? body.title : "",
      // Keyed by field UUID, exactly as stored.
      values: (body.field_values ?? {}) as Record<string, unknown>,
    },
    null,
    scope,
  );

  if (!result.ok) {
    return apiError(422, "invalid_request", "Some field values were rejected", result.errors);
  }

  const detail = await getDocumentDetail(result.id, scope);
  if (!detail) throw new NotFoundError("Document");
  const refs = await loadExternalRefMap("document", [detail.document.id]);

  return json(
    serializeDocument({ ...detail, externalRefs: refs.get(detail.document.id) ?? [] }),
    201,
  );
});
