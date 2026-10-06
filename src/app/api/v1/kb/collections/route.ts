import { json, withApi } from "@/server/api/http";
import { kbReaderFor, kbWriterFor, serializeCollection } from "@/server/api/kb";
import { listCollections } from "@/server/services/kb";

export const dynamic = "force-dynamic";

/** The collections this key may read; `?writable=true` keeps only those it may write to. */
export const GET = withApi("read", async ({ key, url }) => {
  const writer = kbWriterFor(key);
  const rows = (await listCollections(kbReaderFor(key))).map((row) => serializeCollection(row, writer));
  const writable = url.searchParams.get("writable") === "true";
  return json({ data: writable ? rows.filter((row) => row.writable) : rows });
});
