import "server-only";
import { z } from "zod";
import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import { db } from "@/server/db";
import { companies, docTypes, documents, locations } from "@/server/db/schema";

/**
 * Global search over `documents.search_vec`, the generated tsvector that every
 * save refreshes. No extra service, as ARCHITECTURE requires.
 */

export const searchInputSchema = z.object({
  q: z.string().trim().max(200).default(""),
  companyId: z.uuid().optional(),
  docTypeId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  /** Opaque to callers; currently an offset. */
  cursor: z.string().optional(),
});

export type SearchInput = z.input<typeof searchInputSchema>;

export type SearchHit = {
  id: string;
  title: string;
  snippet: string;
  rank: number;
  companyId: string;
  companyName: string;
  docTypeId: string;
  docTypeName: string;
  locationName: string | null;
  updatedAt: Date;
};

export type SearchResults = {
  hits: SearchHit[];
  nextCursor: string | null;
};

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const offset = Number.parseInt(cursor, 10);
  return Number.isFinite(offset) && offset > 0 ? offset : 0;
}

export async function searchDocuments(input: SearchInput): Promise<SearchResults> {
  const { q, companyId, docTypeId, limit, cursor } = searchInputSchema.parse(input);
  if (q === "") return { hits: [], nextCursor: null };

  const offset = decodeCursor(cursor);
  // websearch_to_tsquery understands quoted phrases and OR, and never throws on
  // punctuation the way to_tsquery does.
  const query = sql`websearch_to_tsquery('english', ${q})`;

  const filters: SQL[] = [
    sql`${documents.searchVec} @@ ${query}`,
    isNull(documents.archivedAt) as SQL,
    isNull(companies.archivedAt) as SQL,
  ];
  if (companyId) filters.push(eq(documents.companyId, companyId));
  if (docTypeId) filters.push(eq(documents.docTypeId, docTypeId));

  const rank = sql<number>`ts_rank_cd(${documents.searchVec}, ${query})`;

  const rows = await db
    .select({
      id: documents.id,
      title: documents.title,
      rank,
      snippet: sql<string>`ts_headline(
        'english',
        ${documents.searchText},
        ${query},
        'StartSel=<mark>,StopSel=</mark>,MaxFragments=1,MaxWords=28,MinWords=10,FragmentDelimiter= … '
      )`,
      companyId: companies.id,
      companyName: companies.name,
      docTypeId: docTypes.id,
      docTypeName: docTypes.name,
      locationName: locations.name,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .innerJoin(companies, eq(companies.id, documents.companyId))
    .innerJoin(docTypes, eq(docTypes.id, documents.docTypeId))
    .leftJoin(locations, eq(locations.id, documents.locationId))
    .where(and(...filters))
    .orderBy(desc(rank), desc(documents.updatedAt))
    .limit(limit + 1)
    .offset(offset);

  const hits = rows.slice(0, limit);
  return {
    hits,
    nextCursor: rows.length > limit ? String(offset + limit) : null,
  };
}

/**
 * ts_headline returns HTML with only the <mark> tags we asked for, but the
 * document text around them is untrusted, so it is escaped here and the marks
 * are put back. Callers get a small, safe fragment.
 */
export function snippetToSegments(snippet: string): { text: string; match: boolean }[] {
  const segments: { text: string; match: boolean }[] = [];
  const pattern = /<mark>(.*?)<\/mark>/gs;

  let index = 0;
  for (const match of snippet.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > index) segments.push({ text: snippet.slice(index, start), match: false });
    segments.push({ text: match[1] ?? "", match: true });
    index = start + match[0].length;
  }
  if (index < snippet.length) segments.push({ text: snippet.slice(index), match: false });

  return segments.filter((segment) => segment.text !== "");
}
