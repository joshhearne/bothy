import { json, withApi } from "@/server/api/http";
import { kbReaderFor, serializeArticle } from "@/server/api/kb";
import { NotFoundError } from "@/server/services/errors";
import { getArticle } from "@/server/services/kb";

export const dynamic = "force-dynamic";

/** One article in full: its body, and for a runbook its steps. */
export const GET = withApi<{ id: string }>("read", async ({ key, params }) => {
  const article = await getArticle(params.id, kbReaderFor(key));
  if (!article) throw new NotFoundError("Article");
  return json(await serializeArticle(article));
});
