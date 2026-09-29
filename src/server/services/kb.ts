import "server-only";
import { z } from "zod";
import { and, asc, count, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { db } from "@/server/db";
import {
  kbArticles,
  kbChunks,
  kbCollectionCompanies,
  kbCollections,
} from "@/server/db/schema";
import { writeAudit } from "@/server/services/audit";
import { NotFoundError } from "@/server/services/errors";
import type { CompanyScope } from "@/server/auth/company-scope";

/**
 * The knowledge base: collections of articles brought in from outside, kept
 * apart from the documentation. A collection belongs to no company, but it
 * may be kept to some: it is then read only by those with access to one of
 * them. A collection kept to nobody is for every company.
 *
 * As everywhere else, what a reader may not see is "not found".
 */

export type KbReader = {
  scope: CompanyScope;
  /**
   * MCP is switched per collection; the interface is not. `public` is a
   * reader who has not signed in: it sees only collections put on the public
   * site, less the articles held back from it, and its scope is ignored.
   */
  via: "app" | "mcp" | "public";
  /**
   * Collections an API key was granted by name. A grant reads its collection
   * whatever companies the collection is kept to.
   */
  granted?: readonly string[];
};

function readable(reader: KbReader): SQL[] {
  const filters: SQL[] = [isNull(kbCollections.archivedAt) as SQL];
  if (reader.via === "public") {
    filters.push(eq(kbCollections.publicAccess, true), eq(kbArticlesPublic(), true));
    return filters;
  }
  if (!reader.scope.all) {
    const granted = reader.granted?.length
      ? inArray(kbCollections.id, [...reader.granted])
      : sql`false`;

    // Somebody with access to no company belongs to none of them, so "every
    // company" does not include them either.
    const byCompany =
      reader.scope.companyIds.length === 0
        ? sql`false`
        : sql`(${kbCollections.allCompanies} OR EXISTS (
            SELECT 1 FROM ${kbCollectionCompanies}
            WHERE ${kbCollectionCompanies.collectionId} = ${kbCollections.id}
              AND ${inArray(kbCollectionCompanies.companyId, [...reader.scope.companyIds])}
          ))`;

    filters.push(sql`(${byCompany} OR ${granted})`);
  }
  if (reader.via === "mcp") filters.push(eq(kbCollections.mcpEnabled, true));
  return filters;
}

/**
 * True for an article the public may see. Written against the article so it
 * holds wherever articles are joined, and true where none is — a collection
 * with nothing in it is still a collection.
 */
function kbArticlesPublic(): SQL<boolean> {
  return sql<boolean>`coalesce(NOT ${kbArticles.publicHidden}, true)`;
}

/* ---------- Collections ---------- */

export const collectionInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().trim().max(500).optional(),
  mcpEnabled: z.boolean().default(true),
  publicAccess: z.boolean().default(false),
  /** The companies it is kept to. None means every company. */
  companyIds: z
    .array(z.uuid())
    .default([])
    .transform((ids) => [...new Set(ids)]),
});

export type CollectionInput = z.input<typeof collectionInputSchema>;

export type CollectionRow = {
  id: string;
  name: string;
  description: string | null;
  allCompanies: boolean;
  mcpEnabled: boolean;
  publicAccess: boolean;
  archivedAt: Date | null;
  createdAt: Date;
  articleCount: number;
  unextractedCount: number;
  lastModified: Date | null;
};

export class DuplicateCollectionError extends Error {
  constructor() {
    super("A collection with that name already exists");
    this.name = "DuplicateCollectionError";
  }
}

const collectionColumns = {
  id: kbCollections.id,
  name: kbCollections.name,
  description: kbCollections.description,
  allCompanies: kbCollections.allCompanies,
  mcpEnabled: kbCollections.mcpEnabled,
  publicAccess: kbCollections.publicAccess,
  archivedAt: kbCollections.archivedAt,
  createdAt: kbCollections.createdAt,
  articleCount: sql<number>`count(${kbArticles.id})::int`,
  unextractedCount: sql<number>`(count(${kbArticles.id}) FILTER (WHERE ${kbArticles.extraction} = 'unextracted'))::int`,
  lastModified: sql<Date | null>`max(${kbArticles.dateModified})`,
};

export async function listCollections(reader: KbReader): Promise<CollectionRow[]> {
  return db
    .select(collectionColumns)
    .from(kbCollections)
    .leftJoin(
      kbArticles,
      and(eq(kbArticles.collectionId, kbCollections.id), isNull(kbArticles.archivedAt)),
    )
    .where(and(...readable(reader)))
    .groupBy(kbCollections.id)
    .orderBy(asc(kbCollections.name));
}

/** Everything, archived included. For the administration pages only. */
export async function listAllCollections(): Promise<CollectionRow[]> {
  return db
    .select(collectionColumns)
    .from(kbCollections)
    .leftJoin(
      kbArticles,
      and(eq(kbArticles.collectionId, kbCollections.id), isNull(kbArticles.archivedAt)),
    )
    .groupBy(kbCollections.id)
    .orderBy(asc(kbCollections.name));
}

/** The companies a collection is kept to. Empty means every company. */
export async function listCollectionCompanyIds(collectionId: string): Promise<string[]> {
  const rows = await db
    .select({ companyId: kbCollectionCompanies.companyId })
    .from(kbCollectionCompanies)
    .where(eq(kbCollectionCompanies.collectionId, collectionId));
  return rows.map((row) => row.companyId);
}

export async function getCollection(id: string, reader: KbReader): Promise<CollectionRow | null> {
  const [row] = await db
    .select(collectionColumns)
    .from(kbCollections)
    .leftJoin(
      kbArticles,
      and(eq(kbArticles.collectionId, kbCollections.id), isNull(kbArticles.archivedAt)),
    )
    .where(and(eq(kbCollections.id, id), ...readable(reader)))
    .groupBy(kbCollections.id);
  return row ?? null;
}

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string; cause?: { code?: string } } | null)?.code
    ?? (error as { cause?: { code?: string } } | null)?.cause?.code;
  return code === "23505";
}

export async function createCollection(input: CollectionInput, actorId: string | null): Promise<string> {
  const data = collectionInputSchema.parse(input);

  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(kbCollections)
        .values({
          name: data.name,
          description: data.description ?? null,
          allCompanies: data.companyIds.length === 0,
          mcpEnabled: data.mcpEnabled,
          publicAccess: data.publicAccess,
          createdBy: actorId,
        })
        .returning({ id: kbCollections.id });
      if (!row) throw new Error("Failed to create collection");

      if (data.companyIds.length > 0) {
        await tx
          .insert(kbCollectionCompanies)
          .values(data.companyIds.map((companyId) => ({ collectionId: row.id, companyId })));
      }

      await writeAudit(
        {
          userId: actorId,
          action: "kb_collection.created",
          entity: "kb_collection",
          entityId: row.id,
          detail: { name: data.name, companyIds: data.companyIds },
        },
        tx,
      );
      return row.id;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicateCollectionError();
    throw error;
  }
}

export async function updateCollection(
  id: string,
  input: CollectionInput,
  actorId: string,
): Promise<void> {
  const data = collectionInputSchema.parse(input);

  try {
    await db.transaction(async (tx) => {
      const [row] = await tx
        .update(kbCollections)
        .set({
          name: data.name,
          description: data.description ?? null,
          allCompanies: data.companyIds.length === 0,
          mcpEnabled: data.mcpEnabled,
          publicAccess: data.publicAccess,
        })
        .where(eq(kbCollections.id, id))
        .returning({ id: kbCollections.id });
      if (!row) throw new NotFoundError("Collection");

      await tx.delete(kbCollectionCompanies).where(eq(kbCollectionCompanies.collectionId, id));
      if (data.companyIds.length > 0) {
        await tx
          .insert(kbCollectionCompanies)
          .values(data.companyIds.map((companyId) => ({ collectionId: id, companyId })));
      }

      await writeAudit(
        {
          userId: actorId,
          action: "kb_collection.updated",
          entity: "kb_collection",
          entityId: id,
          detail: {
            name: data.name,
            companyIds: data.companyIds,
            mcpEnabled: data.mcpEnabled,
            publicAccess: data.publicAccess,
          },
        },
        tx,
      );
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicateCollectionError();
    throw error;
  }
}

/** Hidden from readers and from search; nothing is deleted. */
export async function setCollectionArchived(
  id: string,
  archived: boolean,
  actorId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(kbCollections)
      .set({ archivedAt: archived ? new Date() : null })
      .where(eq(kbCollections.id, id))
      .returning({ id: kbCollections.id });
    if (!row) throw new NotFoundError("Collection");

    await writeAudit(
      {
        userId: actorId,
        action: archived ? "kb_collection.archived" : "kb_collection.restored",
        entity: "kb_collection",
        entityId: id,
      },
      tx,
    );
  });
}

/* ---------- Articles ---------- */

export type ArticleSummary = {
  id: string;
  externalId: string | null;
  title: string;
  category: string | null;
  subcategory: string | null;
  sourceUrl: string | null;
  extraction: string;
  dateModified: Date | null;
};

export type ArticleDetail = ArticleSummary & {
  publicHidden: boolean;
  collectionPublic: boolean;
  collectionId: string;
  collectionName: string;
  sourcePath: string | null;
  sourceType: string;
  format: string;
  body: string;
  metadata: Record<string, unknown>;
  dateCreated: Date | null;
  importedAt: Date;
  updatedAt: Date;
};

export const articleListSchema = z.object({
  collectionId: z.uuid(),
  category: z.string().trim().max(200).optional(),
  subcategory: z.string().trim().max(200).optional(),
  unextractedOnly: z.boolean().default(false),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const offset = Number.parseInt(cursor, 10);
  return Number.isFinite(offset) && offset > 0 ? offset : 0;
}

export async function listArticles(
  input: z.input<typeof articleListSchema>,
  reader: KbReader,
): Promise<{ articles: ArticleSummary[]; nextCursor: string | null }> {
  const data = articleListSchema.parse(input);
  const offset = decodeCursor(data.cursor);

  const filters: SQL[] = [
    eq(kbArticles.collectionId, data.collectionId),
    isNull(kbArticles.archivedAt) as SQL,
    ...readable(reader),
  ];
  if (data.category) filters.push(eq(kbArticles.category, data.category));
  if (data.subcategory) filters.push(eq(kbArticles.subcategory, data.subcategory));
  if (data.unextractedOnly) filters.push(eq(kbArticles.extraction, "unextracted"));

  const rows = await db
    .select({
      id: kbArticles.id,
      externalId: kbArticles.externalId,
      title: kbArticles.title,
      category: kbArticles.category,
      subcategory: kbArticles.subcategory,
      sourceUrl: kbArticles.sourceUrl,
      extraction: kbArticles.extraction,
      dateModified: kbArticles.dateModified,
    })
    .from(kbArticles)
    .innerJoin(kbCollections, eq(kbCollections.id, kbArticles.collectionId))
    .where(and(...filters))
    .orderBy(asc(kbArticles.title), asc(kbArticles.id))
    .limit(data.limit + 1)
    .offset(offset);

  return {
    articles: rows.slice(0, data.limit),
    nextCursor: rows.length > data.limit ? String(offset + data.limit) : null,
  };
}

export type CategoryCount = { category: string | null; subcategory: string | null; articles: number };

export async function listCategories(
  collectionId: string,
  reader: KbReader,
): Promise<CategoryCount[]> {
  return db
    .select({
      category: kbArticles.category,
      subcategory: kbArticles.subcategory,
      articles: count(kbArticles.id),
    })
    .from(kbArticles)
    .innerJoin(kbCollections, eq(kbCollections.id, kbArticles.collectionId))
    .where(
      and(
        eq(kbArticles.collectionId, collectionId),
        isNull(kbArticles.archivedAt),
        ...readable(reader),
      ),
    )
    .groupBy(kbArticles.category, kbArticles.subcategory)
    .orderBy(asc(kbArticles.category), asc(kbArticles.subcategory));
}

export async function getArticle(id: string, reader: KbReader): Promise<ArticleDetail | null> {
  const [row] = await db
    .select({
      id: kbArticles.id,
      title: kbArticles.title,
      category: kbArticles.category,
      subcategory: kbArticles.subcategory,
      sourceUrl: kbArticles.sourceUrl,
      extraction: kbArticles.extraction,
      dateModified: kbArticles.dateModified,
      collectionId: kbCollections.id,
      collectionName: kbCollections.name,
      publicHidden: kbArticles.publicHidden,
      collectionPublic: kbCollections.publicAccess,
      externalId: kbArticles.externalId,
      sourcePath: kbArticles.sourcePath,
      sourceType: kbArticles.sourceType,
      format: kbArticles.format,
      body: kbArticles.body,
      metadata: kbArticles.metadata,
      dateCreated: kbArticles.dateCreated,
      importedAt: kbArticles.importedAt,
      updatedAt: kbArticles.updatedAt,
    })
    .from(kbArticles)
    .innerJoin(kbCollections, eq(kbCollections.id, kbArticles.collectionId))
    .where(and(eq(kbArticles.id, id), isNull(kbArticles.archivedAt), ...readable(reader)))
    .limit(1);
  return row ?? null;
}

export type ArticleChunk = { ordinal: number; heading: string; content: string };

/** An article a piece at a time, for a reader that cannot take it whole. */
export async function listChunks(
  articleId: string,
  from: number,
  limit: number,
  reader: KbReader,
): Promise<{ chunks: ArticleChunk[]; total: number } | null> {
  const article = await getArticle(articleId, reader);
  if (!article) return null;

  const [chunks, [totals]] = await Promise.all([
    db
      .select({ ordinal: kbChunks.ordinal, heading: kbChunks.heading, content: kbChunks.content })
      .from(kbChunks)
      .where(and(eq(kbChunks.articleId, articleId), sql`${kbChunks.ordinal} >= ${from}`))
      .orderBy(asc(kbChunks.ordinal))
      .limit(limit),
    db.select({ total: count() }).from(kbChunks).where(eq(kbChunks.articleId, articleId)),
  ]);

  return { chunks, total: totals?.total ?? 0 };
}

/** Holds an article back from the public site, or puts it back. */
export async function setArticlePublicHidden(
  id: string,
  hidden: boolean,
  actorId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(kbArticles)
      .set({ publicHidden: hidden })
      .where(eq(kbArticles.id, id))
      .returning({ id: kbArticles.id, title: kbArticles.title });
    if (!row) throw new NotFoundError("Article");

    await writeAudit(
      {
        userId: actorId,
        action: hidden ? "kb_article.withheld" : "kb_article.published",
        entity: "kb_article",
        entityId: id,
        detail: { title: row.title },
      },
      tx,
    );
  });
}

/* ---------- Search ---------- */

export const kbSearchSchema = z.object({
  q: z.string().trim().max(200).default(""),
  collectionId: z.uuid().optional(),
  category: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
});

export type KbSearchInput = z.input<typeof kbSearchSchema>;

export type KbHit = {
  articleId: string;
  title: string;
  collectionId: string;
  collectionName: string;
  category: string | null;
  subcategory: string | null;
  sourceUrl: string | null;
  dateModified: Date | null;
  /** The best-matching piece of the article, and where in it that piece is. */
  chunk: number;
  heading: string;
  snippet: string;
  rank: number;
};

/**
 * Keyword search over the chunks, one hit per article: the piece of it that
 * matched best. There is no vector index — the database is plain Postgres —
 * so ranking is ts_rank_cd with the title and headings weighted above body.
 */
export async function searchKb(
  input: KbSearchInput,
  reader: KbReader,
): Promise<{ hits: KbHit[]; nextCursor: string | null }> {
  const { q, collectionId, category, limit, cursor } = kbSearchSchema.parse(input);
  if (q === "") return { hits: [], nextCursor: null };

  const offset = decodeCursor(cursor);
  const query = sql`websearch_to_tsquery('english', ${q})`;

  const filters: SQL[] = [
    sql`${kbChunks.searchVec} @@ ${query}`,
    isNull(kbArticles.archivedAt) as SQL,
    ...readable(reader),
  ];
  if (collectionId) filters.push(eq(kbChunks.collectionId, collectionId));
  if (category) filters.push(eq(kbArticles.category, category));

  const rank = sql<number>`ts_rank_cd(${kbChunks.searchVec}, ${query}, 1)`;

  const best = db
    .selectDistinctOn([kbChunks.articleId], {
      articleId: kbChunks.articleId,
      chunk: kbChunks.ordinal,
      heading: kbChunks.heading,
      content: kbChunks.content,
      rank: rank.as("rank"),
    })
    .from(kbChunks)
    .innerJoin(kbArticles, eq(kbArticles.id, kbChunks.articleId))
    .innerJoin(kbCollections, eq(kbCollections.id, kbChunks.collectionId))
    .where(and(...filters))
    .orderBy(kbChunks.articleId, desc(rank), asc(kbChunks.ordinal))
    .as("best");

  const rows = await db
    .select({
      articleId: kbArticles.id,
      title: kbArticles.title,
      collectionId: kbCollections.id,
      collectionName: kbCollections.name,
      category: kbArticles.category,
      subcategory: kbArticles.subcategory,
      sourceUrl: kbArticles.sourceUrl,
      dateModified: kbArticles.dateModified,
      chunk: best.chunk,
      heading: best.heading,
      rank: best.rank,
      // Headlined only for the rows that are returned, not for every match.
      snippet: sql<string>`ts_headline(
        'english',
        ${best.content},
        ${query},
        'StartSel=<mark>,StopSel=</mark>,MaxFragments=2,MaxWords=30,MinWords=12,FragmentDelimiter= … '
      )`,
    })
    .from(best)
    .innerJoin(kbArticles, eq(kbArticles.id, best.articleId))
    .innerJoin(kbCollections, eq(kbCollections.id, kbArticles.collectionId))
    .orderBy(desc(best.rank), desc(kbArticles.dateModified), asc(kbArticles.id))
    .limit(limit + 1)
    .offset(offset);

  return {
    hits: rows.slice(0, limit),
    nextCursor: rows.length > limit ? String(offset + limit) : null,
  };
}
