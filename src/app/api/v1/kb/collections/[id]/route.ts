import { json, withApi } from "@/server/api/http";
import { kbReaderFor, kbWriterFor, serializeCollection } from "@/server/api/kb";
import { ARTICLE_KINDS, type ArticleKind } from "@/server/kb/extract";
import { NotFoundError } from "@/server/services/errors";
import { collectionProfile, getCollection, listCategories } from "@/server/services/kb";

export const dynamic = "force-dynamic";

/** One collection with its categories and how many articles each holds. */
export const GET = withApi<{ id: string }>("read", async ({ key, params, url }) => {
  const reader = kbReaderFor(key, url);
  const collection = await getCollection(params.id, reader);
  if (!collection) throw new NotFoundError("Collection");
  const kindParam = url.searchParams.get("kind");
  const kind = (ARTICLE_KINDS as readonly string[]).includes(kindParam ?? "") ? (kindParam as ArticleKind) : undefined;
  const [categories, profile] = await Promise.all([
    listCategories(collection.id, reader, kind),
    collectionProfile(collection.id, reader),
  ]);
  return json({
    ...serializeCollection(collection, kbWriterFor(key)),
    kinds: profile.kinds,
    source_types: profile.sourceTypes.map((row) => ({ source_type: row.sourceType, articles: row.articles })),
    categories: categories.map((row) => ({
      category: row.category,
      subcategory: row.subcategory,
      articles: row.articles,
    })),
  });
});
