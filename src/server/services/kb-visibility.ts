import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db, type Executor } from "@/server/db";
import { kbArticles, kbHiddenCategories, kbHideRules } from "@/server/db/schema";
import { writeAudit } from "@/server/services/audit";
import { NotFoundError } from "@/server/services/errors";
import {
  compilePattern,
  splitPatterns,
  type HideRuleInput,
  type HideScope,
} from "@/server/kb/hide-patterns";

/**
 * What keeps an article off the public site besides somebody holding it
 * back by hand: a rule that matches its title, its category or section, or
 * the file it came from; or its category held back whole. Both are kept as
 * policy and applied to the articles, so every reader of `public_hidden`
 * sees one answer, and an article imported tomorrow into a hidden category
 * is hidden on arrival. `hidden_by` remembers why, so a rule that is
 * removed lets its articles go and leaves the hand-held ones alone.
 */

export const MAX_PATTERN = 200;
export const MAX_RULES = 200;

/** A rule that cannot be saved as given; the message is for the form. */
export class HideRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HideRuleError";
  }
}

export class BadPatternError extends HideRuleError {
  constructor(pattern: string) {
    super(`"${pattern}" is not a valid regular expression`);
    this.name = "BadPatternError";
  }
}

export type HideRuleRow = {
  id: string;
  pattern: string;
  isRegex: boolean;
  matchArticles: boolean;
  matchCategories: boolean;
  matchFiles: boolean;
  /** How many live articles the rule holds back on its own. */
  articles: number;
  createdAt: Date;
};

export type HidePreview = {
  /** Live articles the patterns would hold back, all scopes together. */
  total: number;
  /** Of them, matched by title. */
  byTitle: number;
  /** Of them, matched by the name of their category or section. */
  byCategory: number;
  /** Distinct category and section names matched. */
  categories: number;
  /** Of them, matched by the file they came from. */
  byFile: number;
};

export type CategoryVisibility = { category: string; articles: number; hidden: boolean };

/** What a file is matched by: its original name, else the path it was imported from. */
const FILE_NAME = sql`lower(coalesce(a.metadata->'original'->>'name', a.source_path, ''))`;

/** Where one rule bites, as SQL over a `kb_articles` row aliased `a`. */
function ruleHits(regex: string, fileRegex: string, scope: HideScope) {
  const parts = [];
  if (scope.matchArticles) parts.push(sql`a.title ~* ${regex}`);
  if (scope.matchCategories) {
    parts.push(sql`(coalesce(a.category, '') ~* ${regex} OR coalesce(a.subcategory, '') ~* ${regex})`);
  }
  if (scope.matchFiles) {
    parts.push(sql`(a.source_type ~* ${fileRegex} OR ${FILE_NAME} ~* ${fileRegex})`);
  }
  if (parts.length === 0) return sql`false`;
  return sql`(${sql.join(parts, sql` OR `)})`;
}

/**
 * Applies the collection's rules and hidden categories to its articles, or
 * to one of them. A hand-held article stays held; one held by a policy that
 * no longer bites is let go.
 */
export async function applyVisibility(collectionId: string, articleId?: string, exec: Executor = db): Promise<void> {
  const only = articleId ? sql` AND a.id = ${articleId}` : sql``;
  await exec.execute(sql`
    WITH hit AS (
      SELECT a.id,
        EXISTS (
          SELECT 1 FROM kb_hide_rules r
          WHERE r.collection_id = a.collection_id AND (
            (r.match_articles AND a.title ~* r.regex)
            OR (r.match_categories AND (coalesce(a.category, '') ~* r.regex OR coalesce(a.subcategory, '') ~* r.regex))
            OR (r.match_files AND (a.source_type ~* r.file_regex
              OR lower(coalesce(a.metadata->'original'->>'name', a.source_path, '')) ~* r.file_regex))
          )
        ) AS by_rule,
        EXISTS (
          SELECT 1 FROM kb_hidden_categories h
          WHERE h.collection_id = a.collection_id AND h.category = coalesce(a.category, '')
        ) AS by_category
      FROM kb_articles a
      WHERE a.collection_id = ${collectionId}${only}
    ),
    want AS (
      SELECT a.id,
        (hit.by_rule OR hit.by_category OR a.hidden_by IS NOT DISTINCT FROM 'manual') AS hidden,
        CASE
          WHEN a.hidden_by = 'manual' THEN 'manual'
          WHEN hit.by_rule THEN 'rule'
          WHEN hit.by_category THEN 'category'
          ELSE NULL
        END AS reason
      FROM kb_articles a JOIN hit ON hit.id = a.id
    )
    UPDATE kb_articles a
    SET public_hidden = want.hidden, hidden_by = want.reason
    FROM want
    WHERE want.id = a.id
      AND (a.public_hidden IS DISTINCT FROM want.hidden OR a.hidden_by IS DISTINCT FROM want.reason)
  `);
}

/** Throws unless the database can read the pattern as a regular expression. */
async function checkRegex(pattern: string): Promise<void> {
  try {
    await db.execute(sql`SELECT '' ~* ${pattern}`);
  } catch {
    throw new BadPatternError(pattern);
  }
}

function normalize(input: HideRuleInput): HideRuleInput {
  const pattern = input.pattern.trim();
  if (pattern === "") throw new HideRuleError("A pattern is needed");
  if (pattern.length > MAX_PATTERN) throw new HideRuleError(`A pattern can be at most ${MAX_PATTERN} characters`);
  if (!input.matchArticles && !input.matchCategories && !input.matchFiles) {
    throw new HideRuleError("Choose what the pattern applies to: articles, categories, or files");
  }
  return { ...input, pattern };
}

export async function listHideRules(collectionId: string): Promise<HideRuleRow[]> {
  const rows = await db
    .select({
      id: kbHideRules.id,
      pattern: kbHideRules.pattern,
      isRegex: kbHideRules.isRegex,
      matchArticles: kbHideRules.matchArticles,
      matchCategories: kbHideRules.matchCategories,
      matchFiles: kbHideRules.matchFiles,
      regex: kbHideRules.regex,
      fileRegex: kbHideRules.fileRegex,
      createdAt: kbHideRules.createdAt,
    })
    .from(kbHideRules)
    .where(eq(kbHideRules.collectionId, collectionId))
    .orderBy(asc(kbHideRules.createdAt));

  const counted: HideRuleRow[] = [];
  for (const row of rows) {
    const { regex, fileRegex, ...rest } = row;
    const [hit] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(sql`kb_articles a`)
      .where(and(sql`a.collection_id = ${collectionId}`, sql`a.archived_at IS NULL`, ruleHits(regex, fileRegex, row)));
    counted.push({ ...rest, articles: hit?.n ?? 0 });
  }
  return counted;
}

/**
 * What the patterns in the box would hold back, before any is saved. Each
 * line, or comma- or tab-separated piece of a literal line, is one pattern;
 * all are previewed together with the same scope.
 */
export async function previewHideRules(
  collectionId: string,
  input: HideRuleInput,
): Promise<HidePreview & { patterns: string[] }> {
  const patterns = splitPatterns(input.pattern, input.isRegex);
  const empty = { total: 0, byTitle: 0, byCategory: 0, categories: 0, byFile: 0, patterns };
  if (patterns.length === 0) return empty;
  if (!input.matchArticles && !input.matchCategories && !input.matchFiles) return empty;
  for (const pattern of patterns) {
    if (pattern.length > MAX_PATTERN) throw new HideRuleError(`A pattern can be at most ${MAX_PATTERN} characters`);
    if (input.isRegex) await checkRegex(pattern);
  }

  const compiled = patterns.map((pattern) => compilePattern(pattern, input.isRegex));
  const any = (scope: HideScope) =>
    sql.join(
      compiled.map((c) => sql`(${ruleHits(c.regex, c.fileRegex, scope)})`),
      sql` OR `,
    );
  const off = { matchArticles: false, matchCategories: false, matchFiles: false };
  const titles = any({ ...off, matchArticles: input.matchArticles });
  const categories = any({ ...off, matchCategories: input.matchCategories });
  const files = any({ ...off, matchFiles: input.matchFiles });

  const [row] = await db
    .select({
      total: sql<number>`count(*) FILTER (WHERE ${titles} OR ${categories} OR ${files})::int`,
      byTitle: sql<number>`count(*) FILTER (WHERE ${titles})::int`,
      byCategory: sql<number>`count(*) FILTER (WHERE ${categories})::int`,
      byFile: sql<number>`count(*) FILTER (WHERE ${files})::int`,
      categories: sql<number>`(
        SELECT count(*)::int FROM (
          SELECT name FROM (
            SELECT coalesce(a.category, '') AS name FROM kb_articles a WHERE a.collection_id = ${collectionId} AND a.archived_at IS NULL
            UNION
            SELECT coalesce(a.subcategory, '') FROM kb_articles a WHERE a.collection_id = ${collectionId} AND a.archived_at IS NULL
          ) names
          WHERE name <> '' AND (${sql.join(
            compiled.map((c) => sql`name ~* ${c.regex}`),
            sql` OR `,
          )})
        ) matched
      )`,
    })
    .from(sql`kb_articles a`)
    .where(and(sql`a.collection_id = ${collectionId}`, sql`a.archived_at IS NULL`));

  return {
    total: row?.total ?? 0,
    byTitle: row?.byTitle ?? 0,
    byCategory: row?.byCategory ?? 0,
    categories: input.matchCategories ? (row?.categories ?? 0) : 0,
    byFile: row?.byFile ?? 0,
    patterns,
  };
}

/** Saves every pattern in the box as its own rule, with the scope given, and applies them. */
export async function addHideRules(collectionId: string, input: HideRuleInput, actorId: string): Promise<number> {
  const scope = normalize(input);
  const patterns = splitPatterns(scope.pattern, scope.isRegex);
  if (patterns.length === 0) throw new HideRuleError("A pattern is needed");
  for (const pattern of patterns) {
    if (pattern.length > MAX_PATTERN) throw new HideRuleError(`A pattern can be at most ${MAX_PATTERN} characters`);
    if (scope.isRegex) await checkRegex(pattern);
  }
  const [{ n: existing } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(kbHideRules)
    .where(eq(kbHideRules.collectionId, collectionId));
  if (existing + patterns.length > MAX_RULES) throw new HideRuleError(`A collection can have at most ${MAX_RULES} rules`);

  await db.transaction(async (tx) => {
    await tx.insert(kbHideRules).values(
      patterns.map((pattern) => ({
        collectionId,
        pattern,
        isRegex: scope.isRegex,
        matchArticles: scope.matchArticles,
        matchCategories: scope.matchCategories,
        matchFiles: scope.matchFiles,
        ...compilePattern(pattern, scope.isRegex),
        createdBy: actorId,
      })),
    );
    await applyVisibility(collectionId, undefined, tx);
    await writeAudit(
      {
        userId: actorId,
        action: "kb_collection.hide_rules_added",
        entity: "kb_collection",
        entityId: collectionId,
        detail: {
          patterns,
          isRegex: scope.isRegex,
          matchArticles: scope.matchArticles,
          matchCategories: scope.matchCategories,
          matchFiles: scope.matchFiles,
        },
      },
      tx,
    );
  });
  return patterns.length;
}

/** Changes one rule's pattern or scope, and applies the change. The pattern is one pattern, not a batch. */
export async function updateHideRule(id: string, input: HideRuleInput, actorId: string): Promise<string> {
  const scope = normalize(input);
  if (scope.isRegex) await checkRegex(scope.pattern);
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({ collectionId: kbHideRules.collectionId, pattern: kbHideRules.pattern })
      .from(kbHideRules)
      .where(eq(kbHideRules.id, id));
    if (!before) throw new NotFoundError("Rule");
    await tx
      .update(kbHideRules)
      .set({
        pattern: scope.pattern,
        isRegex: scope.isRegex,
        matchArticles: scope.matchArticles,
        matchCategories: scope.matchCategories,
        matchFiles: scope.matchFiles,
        ...compilePattern(scope.pattern, scope.isRegex),
      })
      .where(eq(kbHideRules.id, id));
    await applyVisibility(before.collectionId, undefined, tx);
    await writeAudit(
      {
        userId: actorId,
        action: "kb_collection.hide_rule_changed",
        entity: "kb_collection",
        entityId: before.collectionId,
        detail: {
          was: before.pattern,
          pattern: scope.pattern,
          isRegex: scope.isRegex,
          matchArticles: scope.matchArticles,
          matchCategories: scope.matchCategories,
          matchFiles: scope.matchFiles,
        },
      },
      tx,
    );
    return before.collectionId;
  });
}

export async function removeHideRule(id: string, actorId: string): Promise<string> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .delete(kbHideRules)
      .where(eq(kbHideRules.id, id))
      .returning({ collectionId: kbHideRules.collectionId, pattern: kbHideRules.pattern });
    if (!row) throw new NotFoundError("Rule");
    await applyVisibility(row.collectionId, undefined, tx);
    await writeAudit(
      {
        userId: actorId,
        action: "kb_collection.hide_rule_removed",
        entity: "kb_collection",
        entityId: row.collectionId,
        detail: { pattern: row.pattern },
      },
      tx,
    );
    return row.collectionId;
  });
}

/** Every category in the collection with how many live articles it holds and whether it is held back. */
export async function listCategoryVisibility(collectionId: string): Promise<CategoryVisibility[]> {
  const rows = await db
    .select({
      category: sql<string>`coalesce(${kbArticles.category}, '')`,
      articles: sql<number>`count(*)::int`,
      hidden: sql<boolean>`bool_or(${kbHiddenCategories.category} IS NOT NULL)`,
    })
    .from(kbArticles)
    .leftJoin(
      kbHiddenCategories,
      and(
        eq(kbHiddenCategories.collectionId, kbArticles.collectionId),
        eq(kbHiddenCategories.category, sql`coalesce(${kbArticles.category}, '')`),
      ),
    )
    .where(and(eq(kbArticles.collectionId, collectionId), isNull(kbArticles.archivedAt)))
    .groupBy(sql`coalesce(${kbArticles.category}, '')`)
    .orderBy(sql`coalesce(${kbArticles.category}, '')`);
  return rows;
}

/** Replaces the set of categories held back, and applies it. Empty string is "uncategorized". */
export async function setHiddenCategories(collectionId: string, hidden: string[], actorId: string): Promise<void> {
  const wanted = [...new Set(hidden.map((name) => name.trim().slice(0, 200)))];
  await db.transaction(async (tx) => {
    await tx.delete(kbHiddenCategories).where(eq(kbHiddenCategories.collectionId, collectionId));
    if (wanted.length > 0) {
      await tx.insert(kbHiddenCategories).values(wanted.map((category) => ({ collectionId, category })));
    }
    await applyVisibility(collectionId, undefined, tx);
    await writeAudit(
      {
        userId: actorId,
        action: "kb_collection.categories_hidden",
        entity: "kb_collection",
        entityId: collectionId,
        detail: { categories: wanted },
      },
      tx,
    );
  });
}
