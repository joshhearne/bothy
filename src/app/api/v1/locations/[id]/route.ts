import { withApi, json, readJson } from "@/server/api/http";
import { serializeLocation } from "@/server/api/serializers";
import {
  getLocationOrThrow,
  locationInputSchema,
  updateLocation,
} from "@/server/services/locations";
import { loadExternalRefMap } from "@/server/services/external-refs";

export const dynamic = "force-dynamic";

export const GET = withApi<{ id: string }>("read", async ({ params }) => {
  const location = await getLocationOrThrow(params.id);
  const refs = await loadExternalRefMap("location", [location.id]);
  return json(serializeLocation(location, refs.get(location.id) ?? []));
});

export const PATCH = withApi<{ id: string }>("write", async ({ params, request }) => {
  const existing = await getLocationOrThrow(params.id);
  const body = await readJson(request);

  const input = locationInputSchema.parse({
    name: body.name ?? existing.name,
    address: body.address === undefined ? existing.address : body.address,
  });

  await updateLocation(params.id, input, null);
  return json(serializeLocation(await getLocationOrThrow(params.id)));
});
