import { withApi, json } from "@/server/api/http";
import { serializeDocType } from "@/server/api/serializers";
import { listDocTypes, listTemplateFields } from "@/server/services/doc-types";

export const dynamic = "force-dynamic";

/** Includes template fields, as docs/API.md promises. */
export const GET = withApi("read", async () => {
  const docTypes = await listDocTypes();
  const withFields = await Promise.all(
    docTypes.map(async (docType) => serializeDocType(docType, await listTemplateFields(docType.id))),
  );
  return json({ data: withFields, next_cursor: null });
});
