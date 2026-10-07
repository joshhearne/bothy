import { apiError, readJson, withApi } from "@/server/api/http";
import { kbReaderFor, READER_HEADER, readerKeyFrom, voteBodySchema } from "@/server/api/kb";
import { setVote } from "@/server/services/kb-reactions";

export const dynamic = "force-dynamic";

/** The named reader's vote: `{ helpful: true | false }`. */
export const PUT = withApi<{ id: string }>("reactions", async ({ key, params, url, request }) => {
  const reader = readerKeyFrom(request);
  if (!reader) return apiError(400, "invalid_request", `Name the reader in the ${READER_HEADER} header`);
  const body = voteBodySchema.parse(await readJson(request));
  await setVote(reader, params.id, body.helpful, kbReaderFor(key, url));
  return new Response(null, { status: 204 });
});

/** Takes the vote back. */
export const DELETE = withApi<{ id: string }>("reactions", async ({ key, params, url, request }) => {
  const reader = readerKeyFrom(request);
  if (!reader) return apiError(400, "invalid_request", `Name the reader in the ${READER_HEADER} header`);
  await setVote(reader, params.id, null, kbReaderFor(key, url));
  return new Response(null, { status: 204 });
});
