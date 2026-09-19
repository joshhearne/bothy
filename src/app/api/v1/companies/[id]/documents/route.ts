import { withApi, json } from "@/server/api/http";
import { decodeCursor, parseLimit, toPage } from "@/server/api/pagination";
import { getCompanyOrThrow } from "@/server/services/companies";
import { listCompanyDocumentsPage } from "@/server/services/documents";

export const dynamic = "force-dynamic";

export const GET = withApi<{ id: string }>("read", async ({ params, url }) => {
  await getCompanyOrThrow(params.id);

  const limit = parseLimit(url.searchParams.get("limit"));
  const rows = await listCompanyDocumentsPage({
    companyId: params.id,
    docTypeId: url.searchParams.get("doc_type") ?? undefined,
    locationId: url.searchParams.get("location_id") ?? undefined,
    limit,
    cursor: decodeCursor(url.searchParams.get("cursor")),
  });

  const page = toPage(rows, limit, (row) => row.title);

  return json({
    data: page.data.map((row) => ({
      id: row.id,
      title: row.title,
      doc_type: { id: row.docTypeId, name: row.docTypeName },
      location_id: row.locationId,
      updated_at: row.updatedAt.toISOString(),
    })),
    next_cursor: page.next_cursor,
  });
});
