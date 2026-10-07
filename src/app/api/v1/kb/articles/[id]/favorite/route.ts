import { apiError, withApi } from "@/server/api/http";
import { kbReaderFor, READER_HEADER, readerKeyFrom } from "@/server/api/kb";
import { setFavorite } from "@/server/services/kb-reactions";

export const dynamic = "force-dynamic";

function handler(on: boolean) {
  return withApi<{ id: string }>("reactions", async ({ key, params, url, request }) => {
    const reader = readerKeyFrom(request);
    if (!reader) return apiError(400, "invalid_request", `Name the reader in the ${READER_HEADER} header`);
    // Out of the reader's reach is not found, as the service says.
    await setFavorite(reader, params.id, on, kbReaderFor(key, url));
    return new Response(null, { status: 204 });
  });
}

/** Keeps the article for the named reader. */
export const PUT = handler(true);
/** Lets it go. */
export const DELETE = handler(false);
