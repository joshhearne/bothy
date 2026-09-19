import { json, withApi } from "@/server/api/http";
import { parseLimit } from "@/server/api/pagination";
import { getDocumentDetail, listRevisions } from "@/server/services/documents";
import { NotFoundError } from "@/server/services/companies";

export const dynamic = "force-dynamic";

export const GET = withApi<{ id: string }>("read", async ({ params, url }) => {
  const detail = await getDocumentDetail(params.id);
  if (!detail) throw new NotFoundError("Document");

  const revisions = await listRevisions(params.id, parseLimit(url.searchParams.get("limit")));

  return json({
    data: revisions.map((revision) => ({
      id: revision.id,
      title: revision.title,
      field_values: revision.fieldValues,
      edited_by: revision.editedBy,
      created_at: revision.createdAt.toISOString(),
    })),
    next_cursor: null,
  });
});
