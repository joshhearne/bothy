import { apiError, json, readJson, withApi } from "@/server/api/http";
import { serializeDocument } from "@/server/api/serializers";
import { getDocumentDetail, saveDocument } from "@/server/services/documents";
import { loadExternalRefMap } from "@/server/services/external-refs";
import { NotFoundError } from "@/server/services/companies";
import type { CompanyScope } from "@/server/auth/company-scope";

export const dynamic = "force-dynamic";

async function respond(id: string, scope: CompanyScope, status = 200): Promise<Response> {
  const detail = await getDocumentDetail(id, scope);
  if (!detail) throw new NotFoundError("Document");
  const refs = await loadExternalRefMap("document", [id]);
  return json(serializeDocument({ ...detail, externalRefs: refs.get(id) ?? [] }), status);
}

export const GET = withApi<{ id: string }>("read", async ({ params, scope }) => respond(params.id, scope));

/** Partial merge: fields left out of field_values keep their stored value. */
export const PATCH = withApi<{ id: string }>("write", async ({ params, request, scope }) => {
  const body = await readJson(request);

  const result = await saveDocument(
    params.id,
    {
      ...(typeof body.title === "string" ? { title: body.title } : {}),
      values: (body.field_values ?? {}) as Record<string, unknown>,
    },
    null,
    scope,
  );

  if (!result.ok) {
    return apiError(422, "invalid_request", "Some field values were rejected", result.errors);
  }

  return respond(params.id, scope);
});
