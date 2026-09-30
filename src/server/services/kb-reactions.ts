import "server-only";
import { and, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { db } from "@/server/db";
import { kbArticles, kbCollections, kbFavorites, kbVotes } from "@/server/db/schema";
import { NotFoundError } from "@/server/services/errors";
import {
  articleSummaryColumns,
  getArticle,
  readable,
  type ArticleSummary,
  type KbReader,
} from "@/server/services/kb";

/**
 * What readers make of the knowledge base: the articles they keep as
 * favorites, and whether they found one helpful. A reader is a key, not an
 * account; see src/server/kb/identity.ts. Everything here takes the reader's
 * scope as well, so nobody reacts to an article they could not open.
 */

export type ArticleWithCollection = ArticleSummary & {
  collectionId: string;
  collectionName: string;
};

export type Reaction = { favorite: boolean; vote: boolean | null };

/** What one reader has done with one article. */
export async function readerReaction(readerKey: string, articleId: string): Promise<Reaction> {
  const [[favorite], [vote]] = await Promise.all([
    db
      .select({ articleId: kbFavorites.articleId })
      .from(kbFavorites)
      .where(and(eq(kbFavorites.readerKey, readerKey), eq(kbFavorites.articleId, articleId)))
      .limit(1),
    db
      .select({ helpful: kbVotes.helpful })
      .from(kbVotes)
      .where(and(eq(kbVotes.readerKey, readerKey), eq(kbVotes.articleId, articleId)))
      .limit(1),
  ]);
  return { favorite: !!favorite, vote: vote?.helpful ?? null };
}

/** The article, if this reader may read it. Out of reach is not found. */
async function reachable(articleId: string, reader: KbReader): Promise<void> {
  if (!(await getArticle(articleId, reader))) throw new NotFoundError("Article");
}

export async function setFavorite(
  readerKey: string,
  articleId: string,
  on: boolean,
  reader: KbReader,
): Promise<void> {
  await reachable(articleId, reader);
  if (on) {
    await db.insert(kbFavorites).values({ readerKey, articleId }).onConflictDoNothing();
  } else {
    await db
      .delete(kbFavorites)
      .where(and(eq(kbFavorites.readerKey, readerKey), eq(kbFavorites.articleId, articleId)));
  }
}

/** Helpful, not helpful, or null to take the vote back. */
export async function setVote(
  readerKey: string,
  articleId: string,
  helpful: boolean | null,
  reader: KbReader,
): Promise<void> {
  await reachable(articleId, reader);
  if (helpful === null) {
    await db
      .delete(kbVotes)
      .where(and(eq(kbVotes.readerKey, readerKey), eq(kbVotes.articleId, articleId)));
    return;
  }
  await db
    .insert(kbVotes)
    .values({ readerKey, articleId, helpful })
    .onConflictDoUpdate({
      target: [kbVotes.readerKey, kbVotes.articleId],
      set: { helpful, updatedAt: new Date() },
    });
}

const withCollection = {
  ...articleSummaryColumns,
  collectionId: kbCollections.id,
  collectionName: kbCollections.name,
};

function open(reader: KbReader): SQL[] {
  return [isNull(kbArticles.archivedAt) as SQL, ...readable(reader)];
}

/** A reader's favorites, newest first, among what they may still read. */
export async function listFavorites(
  readerKey: string,
  reader: KbReader,
  limit = 100,
): Promise<ArticleWithCollection[]> {
  return db
    .select(withCollection)
    .from(kbFavorites)
    .innerJoin(kbArticles, eq(kbArticles.id, kbFavorites.articleId))
    .innerJoin(kbCollections, eq(kbCollections.id, kbArticles.collectionId))
    .where(and(eq(kbFavorites.readerKey, readerKey), ...open(reader)))
    .orderBy(desc(kbFavorites.createdAt), sql`lower(${kbArticles.title})`)
    .limit(limit);
}

/**
 * The articles readers found most helpful: the share of votes in favor,
 * then how many voted, so one lone thumbs-up does not outrank a hundred.
 * Nothing is listed until somebody has voted.
 */
export async function listHelpful(reader: KbReader, limit = 5): Promise<ArticleWithCollection[]> {
  return db
    .select(withCollection)
    .from(kbArticles)
    .innerJoin(kbCollections, eq(kbCollections.id, kbArticles.collectionId))
    .where(
      and(
        inArray(kbArticles.id, db.selectDistinct({ id: kbVotes.articleId }).from(kbVotes)),
        ...open(reader),
      ),
    )
    .orderBy(
      sql`${articleSummaryColumns.helpful} desc`,
      sql`${articleSummaryColumns.votes} desc`,
      sql`lower(${kbArticles.title})`,
    )
    .limit(limit);
}

/** What changed most recently: as the source dated it, or as it arrived. */
export async function listRecent(reader: KbReader, limit = 10): Promise<ArticleWithCollection[]> {
  return db
    .select(withCollection)
    .from(kbArticles)
    .innerJoin(kbCollections, eq(kbCollections.id, kbArticles.collectionId))
    .where(and(...open(reader)))
    .orderBy(
      sql`coalesce(${kbArticles.dateModified}, ${kbArticles.updatedAt}) desc`,
      sql`lower(${kbArticles.title})`,
    )
    .limit(limit);
}
