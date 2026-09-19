import { json, withApi } from "@/server/api/http";
import { parseLimit } from "@/server/api/pagination";
import { searchDocuments } from "@/server/services/search";

export const dynamic = "force-dynamic";

export const GET = withApi("read", async ({ url }) => {
  const results = await searchDocuments({
    q: url.searchParams.get("q") ?? "",
    companyId: url.searchParams.get("company_id") ?? undefined,
    docTypeId: url.searchParams.get("doc_type") ?? undefined,
    limit: parseLimit(url.searchParams.get("limit")),
    cursor: url.searchParams.get("cursor") ?? undefined,
  });

  return json({
    data: results.hits.map((hit) => ({
      id: hit.id,
      title: hit.title,
      company: { id: hit.companyId, name: hit.companyName },
      doc_type: { id: hit.docTypeId, name: hit.docTypeName },
      location_name: hit.locationName,
      updated_at: hit.updatedAt.toISOString(),
    })),
    next_cursor: results.nextCursor,
  });
});
