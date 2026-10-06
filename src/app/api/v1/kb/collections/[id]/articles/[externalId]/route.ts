import { apiError, json, readJson, withApi } from "@/server/api/http";
import { kbReaderFor, kbUpsertBodySchema, kbWriterFor, serializeArticle } from "@/server/api/kb";
import { RunbookStepError } from "@/server/kb/runbook";
import { NotFoundError } from "@/server/services/errors";
import { getArticle } from "@/server/services/kb";
import { archiveArticle, findArticleByExternalId, writeArticle } from "@/server/services/kb-write";

export const dynamic = "force-dynamic";

type Params = { id: string; externalId: string };

/** Writes the article the collection holds under this external id, creating it when there is none. */
export const PUT = withApi<Params>("write", async ({ key, params, request }) => {
  const body = kbUpsertBodySchema.parse(await readJson(request));
  const externalId = decodeURIComponent(params.externalId);
  let result;
  try {
    result = await writeArticle(
      {
        collectionId: params.id,
        externalId,
        title: body.title,
        body: body.body,
        category: body.category,
        subcategory: body.subcategory,
        kind: body.kind,
        sourceUrl: body.source_url,
        publicHidden: body.internal_only,
      },
      kbWriterFor(key),
    );
  } catch (error) {
    if (error instanceof RunbookStepError) return apiError(400, "invalid_request", error.message);
    throw error;
  }
  const article = await getArticle(result.articleId, kbReaderFor(key));
  if (!article) throw new NotFoundError("Article");
  return json({ ...(await serializeArticle(article)), outcome: result.outcome }, result.outcome === "created" ? 201 : 200);
});

/** Archives the article under this external id. Nothing is deleted. */
export const DELETE = withApi<Params>("write", async ({ key, params }) => {
  const writer = kbWriterFor(key);
  const articleId = await findArticleByExternalId(params.id, decodeURIComponent(params.externalId), writer);
  if (!articleId) throw new NotFoundError("Article");
  await archiveArticle(articleId, writer);
  return new Response(null, { status: 204 });
});
