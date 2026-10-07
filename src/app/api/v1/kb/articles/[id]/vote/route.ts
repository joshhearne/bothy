import { apiError, readJson, withApi } from "@/server/api/http";
import { kbReaderFor, reactionsAllowed, READER_HEADER, readerKeyFrom, voteBodySchema } from "@/server/api/kb";
import { NotFoundError } from "@/server/services/errors";
import { getArticle } from "@/server/services/kb";
import { setVote } from "@/server/services/kb-reactions";

async function allowed(key: Parameters<typeof reactionsAllowed>[0], id: string, url: URL) {
  const article = await getArticle(id, kbReaderFor(key, url));
  if (!article) throw new NotFoundError("Article");
  return reactionsAllowed(key, article.collectionId);
}

export const dynamic = "force-dynamic";

/** The named reader's vote: `{ helpful: true | false }`. */
export const PUT = withApi<{ id: string }>("reactions", async ({ key, params, url, request }) => {
  const reader = readerKeyFrom(request);
  if (!reader) return apiError(400, "invalid_request", `Name the reader in the ${READER_HEADER} header`);
  const body = voteBodySchema.parse(await readJson(request));
  if (!(await allowed(key, params.id, url))) return apiError(403, "forbidden", "This key may not keep reactions on this collection");
  await setVote(reader, params.id, body.helpful, kbReaderFor(key, url));
  return new Response(null, { status: 204 });
});

/** Takes the vote back. */
export const DELETE = withApi<{ id: string }>("reactions", async ({ key, params, url, request }) => {
  const reader = readerKeyFrom(request);
  if (!reader) return apiError(400, "invalid_request", `Name the reader in the ${READER_HEADER} header`);
  if (!(await allowed(key, params.id, url))) return apiError(403, "forbidden", "This key may not keep reactions on this collection");
  await setVote(reader, params.id, null, kbReaderFor(key, url));
  return new Response(null, { status: 204 });
});
