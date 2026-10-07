import { apiError, json, withApi } from "@/server/api/http";
import { kbReaderFor, reactionsAllowed, READER_HEADER, readerKeyFrom, serializeReactions } from "@/server/api/kb";
import { NotFoundError } from "@/server/services/errors";
import { getArticle } from "@/server/services/kb";

export const dynamic = "force-dynamic";

/** Everyone's favorites and votes on the article, and the named reader's own. */
export const GET = withApi<{ id: string }>("reactions", async ({ key, params, url, request }) => {
  const reader = readerKeyFrom(request);
  if (!reader) return apiError(400, "invalid_request", `Name the reader in the ${READER_HEADER} header`);
  const article = await getArticle(params.id, kbReaderFor(key, url));
  if (!article) throw new NotFoundError("Article");
  if (!reactionsAllowed(key, article.collectionId)) return apiError(403, "forbidden", "This key may not keep reactions on this collection");
  return json(await serializeReactions(article.id, reader));
});
