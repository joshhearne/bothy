import { json, withApi } from "@/server/api/http";
import { kbReaderFor, kbWriterFor, serializeCollection } from "@/server/api/kb";
import { ARTICLE_KINDS, type ArticleKind } from "@/server/kb/extract";
import { NotFoundError } from "@/server/services/errors";
import { getCollection, listCategories } from "@/server/services/kb";

export const dynamic = "force-dynamic";

/** One collection with its categories and how many articles each holds. */
export const GET = withApi<{ id: string }>("read", async ({ key, params, url }) => {
  const reader = kbReaderFor(key);
  const collection = await getCollection(params.id, reader);
  if (!collection) throw new NotFoundError("Collection");
  const kindParam = url.searchParams.get("kind");
  const kind = (ARTICLE_KINDS as readonly string[]).includes(kindParam ?? "") ? (kindParam as ArticleKind) : undefined;
  const categories = await listCategories(collection.id, reader, kind);
  return json({
    ...serializeCollection(collection, kbWriterFor(key)),
    categories: categories.map((row) => ({
      category: row.category,
      subcategory: row.subcategory,
      articles: row.articles,
    })),
  });
});
