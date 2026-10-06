import "server-only";
import { z } from "zod";
import type { AuthenticatedKey } from "@/server/services/api-keys";
import type { KbReader, ArticleSummary, ArticleDetail, KbHit, CollectionRow } from "@/server/services/kb";
import { mayWrite, type KbWriter } from "@/server/services/kb-write";
import { publicAddressFor } from "@/server/kb/share";
import { ARTICLE_KINDS } from "@/server/kb/extract";

/**
 * The knowledge base over REST: the same reads MCP offers and the same
 * writes a grant allows, as plain routes under /api/v1/kb. A key reads the
 * collections its companies or its grants give it; only the MCP door is one
 * a collection can close, so `mcp_enabled` plays no part here.
 */

export function kbReaderFor(key: AuthenticatedKey): KbReader {
  return {
    scope: key.companies,
    via: "api",
    granted: key.kbGrants.map((grant) => grant.collectionId),
  };
}

export function kbWriterFor(key: AuthenticatedKey): KbWriter {
  return { via: "api", scope: key.companies, grants: key.kbGrants, keyId: key.id, keyName: key.name };
}

/** The body a PUT carries, in the API's own words. */
export const kbUpsertBodySchema = z.object({
  title: z.string().trim().min(1).max(500),
  body: z.string().min(1),
  category: z.string().trim().min(1).max(200).optional(),
  subcategory: z.string().trim().min(1).max(200).optional(),
  kind: z.enum(ARTICLE_KINDS).optional(),
  source_url: z.string().trim().max(2000).optional(),
  /** True keeps the article off the public site; false puts it back. Left out, it stays as it was. */
  internal_only: z.boolean().optional(),
});

export function serializeCollection(row: CollectionRow, writer: Pick<KbWriter, "grants" | "via">) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    site_url: row.siteUrl ?? null,
    public: row.publicAccess,
    writable: mayWrite(writer, row.id),
    articles: row.articleCount,
    created_at: row.createdAt.toISOString(),
  };
}

export function serializeArticleSummary(article: ArticleSummary, collection?: { id: string; name: string }) {
  return {
    id: article.id,
    external_id: article.externalId,
    title: article.title,
    kind: article.kind,
    category: article.category,
    subcategory: article.subcategory,
    source_url: article.sourceUrl,
    date_modified: article.dateModified?.toISOString() ?? null,
    readable: article.extraction === "ok",
    ...(collection ? { collection } : {}),
  };
}

export async function serializeArticle(article: ArticleDetail) {
  return {
    ...serializeArticleSummary(article, { id: article.collectionId, name: article.collectionName }),
    body: article.body,
    format: article.format,
    ...(article.kind === "runbook" ? { steps: article.steps } : {}),
    internal_only: article.publicHidden,
    public_url: await publicAddressFor(article),
    attachments: {
      documents: article.metadata.doc_attachments ?? [],
      images: article.metadata.image_attachments ?? [],
    },
    date_created: article.dateCreated?.toISOString() ?? null,
    updated_at: article.updatedAt.toISOString(),
  };
}

export function serializeHit(hit: KbHit) {
  return {
    id: hit.articleId,
    title: hit.title,
    kind: hit.kind,
    collection: { id: hit.collectionId, name: hit.collectionName },
    category: hit.category,
    subcategory: hit.subcategory,
    source_url: hit.sourceUrl,
    date_modified: hit.dateModified?.toISOString() ?? null,
    matched: { chunk: hit.chunk, heading: hit.heading, snippet: hit.snippet },
  };
}
