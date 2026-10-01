import "server-only";
import { z } from "zod";
import { and, asc, count, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { db } from "@/server/db";
import {
  kbArticles,
  kbChunks,
  kbCollectionCompanies,
  kbCollections,
  kbFavorites,
  kbVotes,
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

export function readable(reader: KbReader): SQL[] {
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

/* ---------- Ordering ---------- */

export const COLLECTION_SORTS = ["name", "modified", "articles", "favorites", "helpful"] as const;
export const ARTICLE_SORTS = ["name", "modified", "favorites", "helpful"] as const;
export type CollectionSort = (typeof COLLECTION_SORTS)[number];
export type ArticleSort = (typeof ARTICLE_SORTS)[number];
export type SortDirection = "asc" | "desc";

/**
 * What an article came from, as a reader would sort it: a PDF, a Word
 * document, or an article written or imported as one. Shown as a filter only
 * when a collection holds more than one kind.
 */
export const ARTICLE_TYPES = ["pdf", "docx", "article"] as const;
export type ArticleType = (typeof ARTICLE_TYPES)[number];

/** What a reader asked to sort by, or the default when they asked for nothing. */
export function collectionOrder(
  sort?: string,
  dir?: string,
): { sort: CollectionSort; dir: SortDirection } {
  const chosen = (COLLECTION_SORTS as readonly string[]).includes(sort ?? "")
    ? (sort as CollectionSort)
    : "name";
  return { sort: chosen, dir: direction(chosen, dir) };
}

export function articleOrder(sort?: string, dir?: string): { sort: ArticleSort; dir: SortDirection } {
  const chosen = (ARTICLE_SORTS as readonly string[]).includes(sort ?? "")
    ? (sort as ArticleSort)
    : "name";
  return { sort: chosen, dir: direction(chosen, dir) };
}

/** Names run A to Z unless asked otherwise; everything else runs most first. */
function direction(sort: string, dir?: string): SortDirection {
  if (dir === "asc" || dir === "desc") return dir;
  return sort === "name" ? "asc" : "desc";
}

/** When an article last changed: what the source said, or failing that when it arrived. */
const articleChanged = sql<Date>`coalesce(${kbArticles.dateModified}, ${kbArticles.updatedAt})`;

/** Readers' favorites and votes on one article, as columns beside it. */
const articleFavorites = sql<number>`(select count(*) from ${kbFavorites} f where f.article_id = ${kbArticles.id})::int`;
const articleVotes = sql<number>`(select count(*) from ${kbVotes} v where v.article_id = ${kbArticles.id})::int`;
/** 0 to 100, the share of votes that found it helpful; null before anyone has voted. */
const articleHelpful = sql<number | null>`(select round(100.0 * count(*) filter (where v.helpful) / nullif(count(*), 0)) from ${kbVotes} v where v.article_id = ${kbArticles.id})::int`;

/** The same, over every article a collection holds. */
const collectionFavorites = sql<number>`(select count(*) from ${kbFavorites} f join ${kbArticles} a on a.id = f.article_id where a.collection_id = ${kbCollections.id} and a.archived_at is null)::int`;
const collectionHelpful = sql<number | null>`(select round(100.0 * count(*) filter (where v.helpful) / nullif(count(*), 0)) from ${kbVotes} v join ${kbArticles} a on a.id = v.article_id where a.collection_id = ${kbCollections.id} and a.archived_at is null)::int`;

function directed(expression: SQL, dir: SortDirection): SQL {
  // What has no value yet goes last whichever way the list runs.
  return dir === "desc" ? sql`${expression} desc nulls last` : sql`${expression} asc nulls last`;
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
  favorites: number;
  /** 0 to 100 across every vote in the collection, or null before any. */
  helpful: number | null;
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
  lastModified: sql<Date | null>`max(${articleChanged})`,
  favorites: collectionFavorites,
  helpful: collectionHelpful,
};

function collectionOrderBy(order: { sort: CollectionSort; dir: SortDirection }): SQL[] {
  const by: Record<CollectionSort, SQL> = {
    name: sql`lower(${kbCollections.name})`,
    modified: sql`max(${articleChanged})`,
    articles: sql`count(${kbArticles.id})`,
    favorites: collectionFavorites,
    helpful: collectionHelpful,
  };
  return [directed(by[order.sort], order.dir), sql`lower(${kbCollections.name}) asc`];
}

export async function listCollections(
  reader: KbReader,
  order: { sort: CollectionSort; dir: SortDirection } = { sort: "name", dir: "asc" },
): Promise<CollectionRow[]> {
  return db
    .select(collectionColumns)
    .from(kbCollections)
    .leftJoin(
      kbArticles,
      and(eq(kbArticles.collectionId, kbCollections.id), isNull(kbArticles.archivedAt)),
    )
    .where(and(...readable(reader)))
    .groupBy(kbCollections.id)
    .orderBy(...collectionOrderBy(order));
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
  favorites: number;
  votes: number;
  /** 0 to 100, or null before anyone has voted. */
  helpful: number | null;
};

/** What a list shows of an article, with what readers made of it. */
export const articleSummaryColumns = {
  id: kbArticles.id,
  externalId: kbArticles.externalId,
  title: kbArticles.title,
  category: kbArticles.category,
  subcategory: kbArticles.subcategory,
  sourceUrl: kbArticles.sourceUrl,
  extraction: kbArticles.extraction,
  dateModified: kbArticles.dateModified,
  favorites: articleFavorites,
  votes: articleVotes,
  helpful: articleHelpful,
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
  /** What the articles came from: documents brought in as files, or articles proper. */
  type: z.enum(ARTICLE_TYPES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
  sort: z.enum(ARTICLE_SORTS).default("name"),
  dir: z.enum(["asc", "desc"]).default("asc"),
});

function articleOrderBy(order: { sort: ArticleSort; dir: SortDirection }): SQL[] {
  const by: Record<ArticleSort, SQL> = {
    name: sql`lower(${kbArticles.title})`,
    modified: articleChanged,
    favorites: articleFavorites,
    helpful: articleHelpful,
  };
  return [
    directed(by[order.sort], order.dir),
    sql`lower(${kbArticles.title}) asc`,
    sql`${kbArticles.id} asc`,
  ];
}

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
  if (data.type) filters.push(typeFilter(data.type));

  const rows = await db
    .select(articleSummaryColumns)
    .from(kbArticles)
    .innerJoin(kbCollections, eq(kbCollections.id, kbArticles.collectionId))
    .where(and(...filters))
    .orderBy(...articleOrderBy({ sort: data.sort, dir: data.dir }))
    .limit(data.limit + 1)
    .offset(offset);

  return {
    articles: rows.slice(0, data.limit),
    nextCursor: rows.length > data.limit ? String(offset + data.limit) : null,
  };
}

export type CategoryCount = { category: string | null; subcategory: string | null; articles: number };

/** See ARTICLE_TYPES, declared with the ordering above. */

function typeFilter(type: ArticleType): SQL {
  if (type === "pdf") return eq(kbArticles.sourceType, "pdf");
  if (type === "docx") return eq(kbArticles.sourceType, "docx");
  return sql`${kbArticles.sourceType} not in ('pdf', 'docx')`;
}

export type TypeCount = { type: ArticleType; articles: number };

export async function listTypes(collectionId: string, reader: KbReader): Promise<TypeCount[]> {
  const rows = await db
    .select({
      type: sql<ArticleType>`case when ${kbArticles.sourceType} in ('pdf', 'docx') then ${kbArticles.sourceType} else 'article' end`,
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
    .groupBy(sql`1`);
  const order = new Map(ARTICLE_TYPES.map((type, index) => [type, index]));
  return rows.sort((a, b) => (order.get(a.type) ?? 9) - (order.get(b.type) ?? 9));
}

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
      favorites: articleFavorites,
      votes: articleVotes,
      helpful: articleHelpful,
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
