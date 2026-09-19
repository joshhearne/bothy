import { apiError, json, readJson, withApi } from "@/server/api/http";
import { getDocumentDetail } from "@/server/services/documents";
import { revealTotp, SecretPermissionError, SecretScopeError } from "@/server/services/vault";
import { VaultNotBrokeredError } from "@/server/vault/types";

export const dynamic = "force-dynamic";

export const POST = withApi<{ itemId: string }>("secrets:reveal", async ({ params, request, key }) => {
  const body = await readJson(request);
  if (typeof body.document_id !== "string" || typeof body.field_id !== "string") {
    return apiError(422, "invalid_request", "document_id and field_id are required");
  }

  const detail = await getDocumentDetail(body.document_id);
  if (!detail) return apiError(404, "not_found", "Document not found");

  try {
    const totp = await revealTotp({
      companyId: detail.document.companyId,
      documentId: body.document_id,
      fieldId: body.field_id,
      itemId: params.itemId,
      actor: { userId: null, apiKeyId: key.id, canReveal: true },
    });

    return json(totp, 200, { "Cache-Control": "no-store" });
  } catch (err) {
    if (err instanceof SecretPermissionError) return apiError(403, "forbidden", err.message);
    if (err instanceof SecretScopeError) return apiError(403, "forbidden", err.message);
    if (err instanceof VaultNotBrokeredError) return apiError(409, "vault_unavailable", err.message);
    throw err;
  }
});
