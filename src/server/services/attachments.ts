import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { attachments, documents } from "@/server/db/schema";
import { env } from "@/lib/env";
import { writeAudit } from "@/server/services/audit";
import { NotFoundError } from "@/server/services/companies";
import { buildStorageKey, getStorage } from "@/server/storage";
import { sanitizeFilename } from "@/server/storage/filename";
import { formatNumber } from "@/i18n/format";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/locales";

export type AttachmentRow = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
};

export class UploadTooLargeError extends Error {
  constructor(limitMb: number) {
    super(`Files must be ${limitMb} MB or smaller`);
    this.name = "UploadTooLargeError";
  }
}

export class EmptyUploadError extends Error {
  constructor() {
    super("Choose a file to upload");
    this.name = "EmptyUploadError";
  }
}

export function maxUploadBytes(): number {
  return env.MAX_UPLOAD_MB * 1024 * 1024;
}

export async function listAttachments(documentId: string): Promise<AttachmentRow[]> {
  return db
    .select({
      id: attachments.id,
      filename: attachments.filename,
      mimeType: attachments.mimeType,
      sizeBytes: attachments.sizeBytes,
      createdAt: attachments.createdAt,
    })
    .from(attachments)
    .where(eq(attachments.documentId, documentId))
    .orderBy(asc(attachments.createdAt));
}

export async function getAttachment(id: string) {
  const [row] = await db.select().from(attachments).where(eq(attachments.id, id)).limit(1);
  return row ?? null;
}

/**
 * Stores the bytes first, then records the row. A failed insert leaves an
 * orphaned object rather than a row pointing at nothing.
 */
export async function addAttachment(
  documentId: string,
  file: File,
  actorId: string,
): Promise<AttachmentRow> {
  if (file.size === 0) throw new EmptyUploadError();
  if (file.size > maxUploadBytes()) throw new UploadTooLargeError(env.MAX_UPLOAD_MB);

  const [document] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);
  if (!document) throw new NotFoundError("Document");

  const filename = sanitizeFilename(file.name);
  const storageKey = buildStorageKey(documentId, filename);
  // The browser's type is a hint, never trusted on the way back out: downloads
  // are always served as attachments with nosniff.
  const mimeType = file.type || "application/octet-stream";

  const storage = await getStorage();
  const body = Buffer.from(await file.arrayBuffer());
  await storage.put(storageKey, body, mimeType);

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(attachments)
      .values({
        documentId,
        filename,
        mimeType,
        storageKey,
        sizeBytes: body.byteLength,
        uploadedBy: actorId,
      })
      .returning({
        id: attachments.id,
        filename: attachments.filename,
        mimeType: attachments.mimeType,
        sizeBytes: attachments.sizeBytes,
        createdAt: attachments.createdAt,
      });
    if (!row) throw new Error("Failed to record attachment");

    await writeAudit(
      {
        userId: actorId,
        action: "attachment.added",
        entity: "attachment",
        entityId: row.id,
        detail: { documentId, filename, sizeBytes: row.sizeBytes },
      },
      tx,
    );

    return row;
  });
}

export async function removeAttachment(id: string, actorId: string): Promise<{ documentId: string }> {
  const row = await getAttachment(id);
  if (!row) throw new NotFoundError("Attachment");

  await db.transaction(async (tx) => {
    await tx.delete(attachments).where(eq(attachments.id, id));
    await writeAudit(
      {
        userId: actorId,
        action: "attachment.removed",
        entity: "attachment",
        entityId: id,
        detail: { documentId: row.documentId, filename: row.filename },
      },
      tx,
    );
  });

  // The row is gone either way; a failed object delete is not worth blocking on.
  try {
    const storage = await getStorage();
    await storage.delete(row.storageKey);
  } catch {
    // Left for the operator to clean up; the audit trail records the removal.
  }

  return { documentId: row.documentId };
}

/** Human-readable size in the reader's locale. */
export function formatBytes(bytes: number, locale: Locale = DEFAULT_LOCALE): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 ? value : Number(value.toFixed(value < 10 ? 1 : 0));
  return `${formatNumber(rounded, locale)} ${units[unit]}`;
}
