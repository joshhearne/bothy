import { apiError, json, withApi } from "@/server/api/http";
import { kbReaderFor, READER_HEADER, readerKeyFrom, serializeFavorite } from "@/server/api/kb";
import { parseLimit } from "@/server/api/pagination";
import { pageFavorites } from "@/server/services/kb-reactions";

export const dynamic = "force-dynamic";

/** The named reader's favorites, newest first, among what they may read. */
export const GET = withApi("reactions", async ({ key, url, request }) => {
  const reader = readerKeyFrom(request);
  if (!reader) return apiError(400, "invalid_request", `Name the reader in the ${READER_HEADER} header`);
  const page = await pageFavorites(
    reader,
    kbReaderFor(key, url),
    parseLimit(url.searchParams.get("limit")),
    url.searchParams.get("cursor") ?? undefined,
  );
  return json({ data: page.favorites.map(serializeFavorite), next_cursor: page.nextCursor });
});
