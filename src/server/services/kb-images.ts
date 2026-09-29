import "server-only";
import { basename } from "node:path";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { kbImages } from "@/server/db/schema";
import { env } from "@/lib/env";
import { getStorage } from "@/server/storage";
import {
  acceptUpload,
  ConversionFailedError,
  ConversionUnavailableError,
  type AcceptedUpload,
} from "@/server/uploads/accept";
import { referencedPaths, rewriteReferences } from "@/server/kb/images";
import { getArticle, type ArticleDetail, type KbReader } from "@/server/services/kb";

/**
 * The pictures of a knowledge base. They come in with an import, beside the
 * articles that show them, and are kept under the path those articles use.
 *
 * A picture is never read on its own. It is read through an article that
 * refers to it, by a reader who may read that article — so one held back from
 * the public site takes its pictures with it.
 */

/** A picture is held to what an attachment is held to. */
export const MAX_IMAGE_BYTES = env.MAX_UPLOAD_MB * 1024 * 1024;

/**
 * The file as a picture, or null when it is not one. What it is comes from
 * its bytes, by the attachment rules. A HEIC that cannot be converted throws,
 * because that is a picture that failed and not a file to pass over.
 */
export async function acceptImage(path: string, bytes: Buffer): Promise<AcceptedUpload | null> {
  try {
    const accepted = await acceptUpload(basename(path), bytes);
    return accepted.category === "image" ? accepted : null;
  } catch (error) {
    if (error instanceof ConversionFailedError || error instanceof ConversionUnavailableError) {
      throw error;
    }
    return null;
  }
}

/** Every picture a collection holds, by path, with the hash it arrived with. */
export async function knownImages(collectionId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ sourcePath: kbImages.sourcePath, contentHash: kbImages.contentHash })
    .from(kbImages)
    .where(eq(kbImages.collectionId, collectionId));
  return new Map(rows.map((row) => [row.sourcePath, row.contentHash]));
}

/**
 * Keeps a picture under its path, replacing what was there. The key is ours
 * and names the content, so the same picture under two paths is stored once.
 */
export async function storeImage(
  collectionId: string,
  path: string,
  contentHash: string,
  accepted: AcceptedUpload,
): Promise<void> {
  const storageKey = `kb/${collectionId}/${contentHash}.${accepted.extension}`;
  const storage = await getStorage();

  const [previous] = await db
    .select({ storageKey: kbImages.storageKey })
    .from(kbImages)
    .where(and(eq(kbImages.collectionId, collectionId), eq(kbImages.sourcePath, path)))
    .limit(1);

  await storage.put(storageKey, accepted.bytes, accepted.mime);

  const values = {
    storageKey,
    mimeType: accepted.mime,
    sizeBytes: accepted.bytes.byteLength,
    contentHash,
  };
  await db
    .insert(kbImages)
    .values({ collectionId, sourcePath: path, ...values })
    .onConflictDoUpdate({
      target: [kbImages.collectionId, kbImages.sourcePath],
      set: { ...values, updatedAt: new Date() },
    });

  if (!previous || previous.storageKey === storageKey) return;

  // What this path used to show is removed once no other path shows it.
  const [others] = await db
    .select({ total: count() })
    .from(kbImages)
    .where(eq(kbImages.storageKey, previous.storageKey));
  if ((others?.total ?? 0) === 0) {
    await storage.delete(previous.storageKey).catch(() => undefined);
  }
}

type Referenced = Pick<ArticleDetail, "collectionId" | "sourcePath" | "format" | "body">;

/** The pictures an article refers to that the collection holds, by the path it used. */
async function picturesOf(article: Referenced): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  if (article.format !== "markdown" || !article.body.includes("](")) return found;

  const paths = referencedPaths(article.body, article.sourcePath);
  if (paths.length === 0) return found;

  const rows = await db
    .select({ id: kbImages.id, sourcePath: kbImages.sourcePath })
    .from(kbImages)
    .where(
      and(
        eq(kbImages.collectionId, article.collectionId),
        inArray(
          sql`lower(${kbImages.sourcePath})`,
          [...new Set(paths.map((path) => path.toLowerCase()))],
        ),
      ),
    );

  const exact = new Map(rows.map((row) => [row.sourcePath, row.id]));
  const folded = new Map(rows.map((row) => [row.sourcePath.toLowerCase(), row.id]));
  for (const path of paths) {
    const id = exact.get(path) ?? folded.get(path.toLowerCase());
    if (id) found.set(path, id);
  }
  return found;
}

/**
 * The article as it is drawn: its pictures pointed at `base`, which is where
 * this reader fetches them from. What is stored is not changed.
 */
export async function withImages<T extends Referenced>(article: T, base: string): Promise<T> {
  const pictures = await picturesOf(article);
  if (article.format !== "markdown") return article;

  return {
    ...article,
    body: rewriteReferences(article.body, article.sourcePath, (path) => {
      const id = pictures.get(path);
      return id ? `${base}/${id}` : null;
    }),
  };
}

export type StoredImage = { body: Buffer; mimeType: string; contentHash: string };

/**
 * One picture of one article. Not found unless the reader may read the
 * article and the article refers to the picture.
 */
export async function readArticleImage(
  articleId: string,
  imageId: string,
  reader: KbReader,
  /** Answers true when the caller already holds this version. */
  held?: (contentHash: string) => boolean,
): Promise<StoredImage | "held" | null> {
  const article = await getArticle(articleId, reader);
  if (!article) return null;

  const pictures = await picturesOf(article);
  if (![...pictures.values()].includes(imageId)) return null;

  const [row] = await db
    .select({
      storageKey: kbImages.storageKey,
      mimeType: kbImages.mimeType,
      contentHash: kbImages.contentHash,
    })
    .from(kbImages)
    .where(and(eq(kbImages.id, imageId), eq(kbImages.collectionId, article.collectionId)))
    .limit(1);
  if (!row) return null;
  if (held?.(row.contentHash)) return "held";

  const storage = await getStorage();
  return {
    body: await storage.get(row.storageKey),
    mimeType: row.mimeType,
    contentHash: row.contentHash,
  };
}

/** The response both sites answer a picture with. */
export function imageResponse(image: StoredImage | "held", etag: string | null): Response {
  const headers = {
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    // private: what one reader may see is not for a shared cache to hand on.
    "Cache-Control": "private, max-age=3600",
    ...(etag ? { ETag: etag } : {}),
  };
  if (image === "held") return new Response(null, { status: 304, headers });

  return new Response(new Uint8Array(image.body), {
    headers: {
      ...headers,
      ETag: `"${image.contentHash}"`,
      "Content-Type": image.mimeType,
      "Content-Length": String(image.body.byteLength),
      "Content-Disposition": "inline",
    },
  });
}

/** Reads the picture and answers with it, a 304, or "not found". */
export async function serveArticleImage(
  request: Request,
  articleId: string,
  imageId: string,
  reader: KbReader,
): Promise<Response> {
  const uuid = /^[0-9a-f-]{36}$/i;
  if (!uuid.test(articleId) || !uuid.test(imageId)) return new Response("Not found", { status: 404 });

  const etag = request.headers.get("if-none-match");
  let image;
  try {
    image = await readArticleImage(articleId, imageId, reader, (hash) => etag === `"${hash}"`);
  } catch {
    return new Response("The image is missing from storage", { status: 502 });
  }
  if (!image) return new Response("Not found", { status: 404 });
  return imageResponse(image, etag);
}
