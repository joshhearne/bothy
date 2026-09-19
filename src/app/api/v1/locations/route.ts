import { withApi, json, readJson } from "@/server/api/http";
import { apiError } from "@/server/api/http";
import { serializeLocation } from "@/server/api/serializers";
import { getCompanyOrThrow } from "@/server/services/companies";
import { createLocation, getLocationOrThrow, locationInputSchema } from "@/server/services/locations";

export const dynamic = "force-dynamic";

export const POST = withApi("write", async ({ request }) => {
  const body = await readJson(request);
  if (typeof body.company_id !== "string") {
    return apiError(422, "invalid_request", "company_id is required");
  }

  await getCompanyOrThrow(body.company_id);
  const input = locationInputSchema.parse({ name: body.name, address: body.address ?? null });

  const { id } = await createLocation(body.company_id, input, null);
  return json(serializeLocation(await getLocationOrThrow(id)), 201);
});
