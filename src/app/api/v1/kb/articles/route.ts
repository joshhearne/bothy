import { json, withApi } from "@/server/api/http";
import { kbReaderFor, serializeArticleSummary, sourceTypesFrom } from "@/server/api/kb";
import { listArticles } from "@/server/services/kb";

export const dynamic = "force-dynamic";

/** A collection's articles, a page at a time. */
export const GET = withApi("read", async ({ key, url }) => {
  const q = url.searchParams;
  const page = await listArticles(
    {
      collectionId: q.get("collection_id") ?? "",
      category: q.get("category") ?? undefined,
      subcategory: q.get("subcategory") ?? undefined,
      kind: (q.get("kind") as "article" | "runbook" | null) ?? undefined,
      updatedSince: q.get("updated_since") ?? undefined,
      sourceTypes: sourceTypesFrom(url),
      limit: q.get("limit") ?? undefined,
      cursor: q.get("cursor") ?? undefined,
      sort: (q.get("sort") as "name" | "modified" | null) ?? undefined,
      dir: (q.get("dir") as "asc" | "desc" | null) ?? undefined,
    },
    kbReaderFor(key, url),
  );
  return json({ data: page.articles.map((article) => serializeArticleSummary(article)), next_cursor: page.nextCursor });
});
