import { withApi, json } from "@/server/api/http";
import { serializeDocType } from "@/server/api/serializers";
import { getDocType } from "@/server/services/doc-types";
import { NotFoundError } from "@/server/services/companies";

export const dynamic = "force-dynamic";

export const GET = withApi<{ id: string }>("read", async ({ params }) => {
  const docType = await getDocType(params.id);
  if (!docType) throw new NotFoundError("Doc type");
  return json(serializeDocType(docType, docType.fields.filter((field) => !field.archivedAt)));
});
