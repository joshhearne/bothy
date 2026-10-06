import { json, readJson, withApi } from "@/server/api/http";
import { setUserGrant } from "@/server/services/kb-grants";

export const dynamic = "force-dynamic";

type Params = { id: string; userId: string };

/** Grants the collection to a person: `{ can_write }`. */
export const PUT = withApi<Params>("admin", async ({ key, params, request }) => {
  const body = await readJson(request);
  const level = body.can_write === true ? "write" : "read";
  await setUserGrant({ collectionId: params.id, userId: params.userId, level }, { apiKeyId: key.id, apiKeyName: key.name });
  return json({ collection_id: params.id, user_id: params.userId, level });
});

export const DELETE = withApi<Params>("admin", async ({ key, params }) => {
  await setUserGrant({ collectionId: params.id, userId: params.userId, level: "none" }, { apiKeyId: key.id, apiKeyName: key.name });
  return new Response(null, { status: 204 });
});
