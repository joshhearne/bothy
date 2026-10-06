import { json, readJson, withApi } from "@/server/api/http";
import { setGrant } from "@/server/services/kb-grants";

export const dynamic = "force-dynamic";

type Params = { id: string; keyId: string };

/** Grants the collection to an API key: `{ can_write }`. */
export const PUT = withApi<Params>("admin", async ({ key, params, request }) => {
  const body = await readJson(request);
  const level = body.can_write === true ? "write" : "read";
  await setGrant({ collectionId: params.id, apiKeyId: params.keyId, level }, { apiKeyId: key.id, apiKeyName: key.name });
  return json({ collection_id: params.id, api_key_id: params.keyId, level });
});

export const DELETE = withApi<Params>("admin", async ({ key, params }) => {
  await setGrant({ collectionId: params.id, apiKeyId: params.keyId, level: "none" }, { apiKeyId: key.id, apiKeyName: key.name });
  return new Response(null, { status: 204 });
});
