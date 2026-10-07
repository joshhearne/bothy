import { json, withApi } from "@/server/api/http";
import { kbReaderFor, serializeHit, sourceTypesFrom } from "@/server/api/kb";
import { searchKb } from "@/server/services/kb";

export const dynamic = "force-dynamic";

/** Keyword search over the collections this key may read; one hit per article. */
export const GET = withApi("read", async ({ key, url }) => {
  const q = url.searchParams;
  const results = await searchKb(
    {
      q: q.get("q") ?? "",
      collectionId: q.get("collection_id") ?? undefined,
      category: q.get("category") ?? undefined,
      kind: (q.get("kind") as "article" | "runbook" | null) ?? undefined,
      sourceTypes: sourceTypesFrom(url),
      limit: q.get("limit") ?? undefined,
      cursor: q.get("cursor") ?? undefined,
    },
    kbReaderFor(key, url),
  );
  return json({ data: results.hits.map(serializeHit), next_cursor: results.nextCursor });
});
