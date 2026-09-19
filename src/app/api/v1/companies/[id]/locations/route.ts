import { withApi, json } from "@/server/api/http";
import { decodeCursor, parseLimit, toPage } from "@/server/api/pagination";
import { serializeLocation } from "@/server/api/serializers";
import { getCompanyOrThrow } from "@/server/services/companies";
import { listLocationsPage } from "@/server/services/locations";
import { loadExternalRefMap } from "@/server/services/external-refs";

export const dynamic = "force-dynamic";

export const GET = withApi<{ id: string }>("read", async ({ params, url }) => {
  await getCompanyOrThrow(params.id);

  const limit = parseLimit(url.searchParams.get("limit"));
  const rows = await listLocationsPage({
    companyId: params.id,
    limit,
    cursor: decodeCursor(url.searchParams.get("cursor")),
  });

  const page = toPage(rows, limit, (row) => row.name);
  const refs = await loadExternalRefMap(
    "location",
    page.data.map((row) => row.id),
  );

  return json({
    data: page.data.map((row) => serializeLocation(row, refs.get(row.id) ?? [])),
    next_cursor: page.next_cursor,
  });
});
