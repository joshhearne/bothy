import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db";
import { kbArticles } from "@/server/db/schema";
import { writeAudit } from "@/server/services/audit";
import { applyVisibility } from "@/server/services/kb-visibility";
import { queueEvent } from "@/server/services/webhooks";
import { ForbiddenError, NotFoundError } from "@/server/services/errors";
import { getCollection, type KbReader } from "@/server/services/kb";
import { ARTICLE_KINDS } from "@/server/kb/extract";
import { sourceKey, storeArticle } from "@/server/services/kb-import";
import { safeUrl } from "@/server/kb/extract";
import { grantsForUser, type KbGrant } from "@/server/services/kb-grants";
import type { CompanyScope } from "@/server/auth/company-scope";

/**
 * Writing to the knowledge base from outside the interface: an application's
 * own tooling keeping its own documentation current. A key writes only to the
 * collections an administrator granted it, and every change is an audit entry
 * naming the key that made it.
 *
 * An article is matched on the `external_id` its author gives it, so writing
 * the same article again replaces it. Nothing is ever deleted: an article
 * that no longer applies is archived.
 */

/**
 * Who is writing: an API key with its grants, or a signed-in person. An
 * administrator may write to any collection; anyone else needs a grant.
 */
export type KbWriter = {
  scope: CompanyScope;
  grants: readonly KbGrant[];
} & (
  | { via: "mcp" | "api"; keyId: string; keyName: string }
  | { via: "app"; userId: string; userName: string; admin: boolean }
);

/** Generous for prose, small next to what a request is allowed to carry. */
const MAX_BODY_CHARS = 1_000_000;

export const articleWriteSchema = z.object({
  collectionId: z.uuid(),
  /**
   * The author's own name for the article, stable across rewrites: a slug
   * such as `billing/refunds`. It is what makes a second write an update.
   */
  externalId: z
    .string()
    .trim()
    .min(1, "external_id is required")
    .max(200)
    .regex(/^[^\u0000-\u001f]+$/, "external_id cannot contain control characters"),
  title: z.string().trim().min(1, "title is required").max(500),
  body: z.string().max(MAX_BODY_CHARS, "body is too long").refine((value) => value.trim() !== "", {
    message: "body is required",
  }),
  category: z.string().trim().min(1).max(200).optional(),
  subcategory: z.string().trim().min(1).max(200).optional(),
  sourceUrl: z
    .string()
    .trim()
    .max(2000)
    .refine((value) => safeUrl(value) !== null, "source_url must be an http or https address")
    .optional(),
  /** True keeps the article off the public site. Left out, it stays as it was. */
  publicHidden: z.boolean().optional(),
  /** A runbook's steps are derived from its body on save. Left out, an article. */
  kind: z.enum(ARTICLE_KINDS).optional(),
});

export function readerFor(writer: Pick<KbWriter, "scope" | "grants"> & { via?: KbWriter["via"] }): KbReader {
  return {
    scope: writer.scope,
    // A key reads by its grants; only the MCP door is one a collection can close.
    via: writer.via ?? "mcp",
    granted: writer.grants.map((grant) => grant.collectionId),
  };
}

export function mayWrite(writer: Pick<KbWriter, "grants"> & { via?: KbWriter["via"]; admin?: boolean }, collectionId: string): boolean {
  if (writer.via === "app" && writer.admin) return true;
  return writer.grants.some((grant) => grant.collectionId === collectionId && grant.canWrite);
}

function attribution(writer: KbWriter): Record<string, unknown> {
  return writer.via === "app"
    ? { via: "app", userId: writer.userId, userName: writer.userName }
    : { via: writer.via, apiKeyId: writer.keyId, apiKeyName: writer.keyName };
}

function writerName(writer: KbWriter): string {
  return writer.via === "app" ? writer.userName : writer.keyName;
}

/**
 * The collection, if this key may write to it. One it cannot see is not
 * found; one it can see and may not change is forbidden, and says why,
 * because the fix is a setting somebody can go and change.
 */
async function writable(collectionId: string, writer: KbWriter) {
  const collection = await getCollection(collectionId, readerFor(writer));
  if (!collection) throw new NotFoundError("Collection");
  if (!mayWrite(writer, collectionId)) {
    throw new ForbiddenError(
      writer.via === "app"
        ? `You may read "${collection.name}" but not change it.`
        : `This key may read "${collection.name}" but not change it. An administrator can allow that under Admin → Knowledge base.`,
    );
  }
  return collection;
}

export type WriteResult = { articleId: string; outcome: "created" | "updated" | "unchanged" };

export async function writeArticle(
  input: z.input<typeof articleWriteSchema>,
  writer: KbWriter,
): Promise<WriteResult> {
  const data = articleWriteSchema.parse(input);
  await writable(data.collectionId, writer);

  const key = sourceKey(data.externalId, data.externalId);
  const sourceUrl = data.sourceUrl ? safeUrl(data.sourceUrl) : null;

  // Everything a reader would see, so a change to any of it is a change.
  const contentHash = createHash("sha256")
    .update(
      JSON.stringify([
        data.title,
        data.body,
        data.category ?? null,
        data.subcategory ?? null,
        sourceUrl,
      ]),
    )
    .digest("hex");

  const [existing] = await db
    .select({
      id: kbArticles.id,
      contentHash: kbArticles.contentHash,
      archivedAt: kbArticles.archivedAt,
      dateCreated: kbArticles.dateCreated,
      publicHidden: kbArticles.publicHidden,
    })
    .from(kbArticles)
    .where(and(eq(kbArticles.collectionId, data.collectionId), eq(kbArticles.sourceKey, key)))
    .limit(1);

  const unchanged = existing && !existing.archivedAt && existing.contentHash === contentHash;
  const hiddenChanged =
    data.publicHidden !== undefined && existing?.publicHidden !== data.publicHidden;

  if (unchanged && !hiddenChanged) return { articleId: existing.id, outcome: "unchanged" };

  const now = new Date();
  const articleId = await storeArticle(
    data.collectionId,
    key,
    null,
    {
      title: data.title,
      body: data.body,
      format: "markdown",
      sourceType: "md",
      extraction: "ok",
      kind: data.kind ?? "article",
      externalId: data.externalId,
      sourceUrl,
      category: data.category ?? null,
      subcategory: data.subcategory ?? null,
      dateCreated: existing?.dateCreated ?? now,
      dateModified: now,
      metadata: { written_by: writerName(writer) },
    },
    contentHash,
  );

  if (data.publicHidden !== undefined) {
    await db
      .update(kbArticles)
      .set({ publicHidden: data.publicHidden, hiddenBy: data.publicHidden ? "manual" : null })
      .where(eq(kbArticles.id, articleId));
    // Meant for the public site, it is still held if a rule or its category holds it.
    if (!data.publicHidden) await applyVisibility(data.collectionId, articleId);
  }

  await writeAudit({
    action: existing ? "kb_article.updated" : "kb_article.created",
    entity: "kb_article",
    entityId: articleId,
    detail: {
      collectionId: data.collectionId,
      externalId: data.externalId,
      title: data.title,
      ...(data.publicHidden !== undefined ? { publicHidden: data.publicHidden } : {}),
      ...attribution(writer),
    },
  });
  await queueEvent("kb.article.upserted", {
    collection_id: data.collectionId,
    article_id: articleId,
    external_id: data.externalId,
    kind: data.kind ?? "article",
  });

  return { articleId, outcome: existing ? "updated" : "created" };
}

/** The live article a collection holds under an external id, as the writer may see it. */
export async function findArticleByExternalId(
  collectionId: string,
  externalId: string,
  writer: KbWriter,
): Promise<string | null> {
  const collection = await getCollection(collectionId, readerFor(writer));
  if (!collection) return null;
  const [row] = await db
    .select({ id: kbArticles.id })
    .from(kbArticles)
    .where(
      and(
        eq(kbArticles.collectionId, collectionId),
        eq(kbArticles.sourceKey, sourceKey(externalId, externalId)),
        isNull(kbArticles.archivedAt),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

/** Hides an article from readers and from search. It can be written again. */
export async function archiveArticle(articleId: string, writer: KbWriter): Promise<void> {
  const [article] = await db
    .select({
      id: kbArticles.id,
      collectionId: kbArticles.collectionId,
      externalId: kbArticles.externalId,
      title: kbArticles.title,
      kind: kbArticles.kind,
    })
    .from(kbArticles)
    .where(and(eq(kbArticles.id, articleId), isNull(kbArticles.archivedAt)))
    .limit(1);
  if (!article) throw new NotFoundError("Article");

  try {
    await writable(article.collectionId, writer);
  } catch (error) {
    // Which collection an article is in is not this key's to learn.
    if (error instanceof NotFoundError) throw new NotFoundError("Article");
    throw error;
  }

  await db.transaction(async (tx) => {
    await tx
      .update(kbArticles)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(kbArticles.id, article.id));

    await writeAudit(
      {
        action: "kb_article.archived",
        entity: "kb_article",
        entityId: article.id,
        detail: {
          collectionId: article.collectionId,
          externalId: article.externalId,
          title: article.title,
          ...attribution(writer),
        },
      },
      tx,
    );
    await queueEvent(
      "kb.article.archived",
      {
        collection_id: article.collectionId,
        article_id: article.id,
        external_id: article.externalId,
        kind: article.kind,
      },
      tx,
    );
  });
}

/** Whether a signed-in person may write to a collection: an administrator anywhere, others where granted. */
export async function userMayWrite(user: { id: string; role: string }, collectionId: string): Promise<boolean> {
  if (user.role === "admin") return true;
  return (await grantsForUser(user.id)).some((grant) => grant.collectionId === collectionId && grant.canWrite);
}
