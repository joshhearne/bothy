import "server-only";
import { appendFile, mkdir, open, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { kbImports } from "@/server/db/schema";
import { env } from "@/lib/env";
import { isWorkers } from "@/lib/runtime";
import { NotFoundError } from "@/server/services/errors";
import { createImportRecord, getImport, importArchive } from "@/server/services/kb-import";

/**
 * Getting an archive onto the server. It arrives in pieces, because what sits
 * in front of an instance — a tunnel, a proxy — caps the size of one request
 * well below the size of a knowledge base. Each piece says where it starts, so
 * a piece sent twice is harmless and a dropped connection can pick up where it
 * left off.
 */

/** Under every request limit likely to be in the way, nginx's included. */
export const UPLOAD_PIECE_BYTES = 8 * 1024 * 1024;

export class UploadError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Where the next piece should start, when the client had it wrong. */
    readonly offset?: number,
  ) {
    super(message);
    this.name = "UploadError";
  }
}

export const startUploadSchema = z.object({
  collectionId: z.uuid(),
  filename: z.string().trim().min(1).max(300),
  size: z.number().int().positive(),
  /** For every article in it that names no category of its own. */
  category: z.string().trim().max(200).optional(),
});

function scratch(): string {
  return env.KB_IMPORT_DIR ?? join(tmpdir(), "trove-kb-kb-imports");
}

function pathFor(importId: string): string {
  // The id is ours, a uuid, so the path cannot be steered.
  if (!/^[0-9a-f-]{36}$/.test(importId)) throw new NotFoundError("Import");
  return join(scratch(), `${importId}.zip`);
}

export async function startUpload(
  input: z.input<typeof startUploadSchema>,
  actorId: string,
): Promise<{ id: string; pieceBytes: number }> {
  if (isWorkers()) {
    throw new UploadError("Imports are not available in this deployment.", 501);
  }

  const data = startUploadSchema.parse(input);
  const limit = env.KB_IMPORT_MAX_MB * 1024 * 1024;
  if (data.size > limit) {
    throw new UploadError(`An archive may be up to ${env.KB_IMPORT_MAX_MB} MB.`, 413);
  }

  let id: string;
  try {
    id = await createImportRecord({
      collectionId: data.collectionId,
      source: "upload",
      filename: data.filename,
    category: data.category || null,
      expectedBytes: data.size,
      actorId,
    });
  } catch {
    throw new UploadError("That collection does not exist.", 404);
  }

  await mkdir(scratch(), { recursive: true });
  await (await open(pathFor(id), "w")).close();
  return { id, pieceBytes: UPLOAD_PIECE_BYTES };
}

export async function appendPiece(importId: string, offset: number, bytes: Buffer): Promise<number> {
  const record = await getImport(importId);
  if (!record || record.status !== "uploading") throw new UploadError("No such upload.", 404);

  const expected = record.expectedBytes ?? 0;
  if (bytes.length === 0 || bytes.length > UPLOAD_PIECE_BYTES) {
    throw new UploadError("That piece is the wrong size.", 400);
  }

  // The file is the truth about what has arrived, not the row.
  const { size } = await stat(pathFor(importId)).catch(() => ({ size: -1 }));
  if (size < 0) throw new UploadError("No such upload.", 404);
  if (offset !== size) throw new UploadError("That piece is out of order.", 409, size);
  if (size + bytes.length > expected) {
    throw new UploadError("More was sent than was announced.", 400);
  }

  await appendFile(pathFor(importId), bytes);
  const received = size + bytes.length;
  await db.update(kbImports).set({ receivedBytes: received }).where(eq(kbImports.id, importId));
  return received;
}

/**
 * Starts the import and returns at once. The work carries on in this process
 * and records its progress on the import, which is what the page watches.
 */
export async function completeUpload(importId: string, actorId: string): Promise<void> {
  const record = await getImport(importId);
  if (!record || record.status !== "uploading") throw new UploadError("No such upload.", 404);

  const file = pathFor(importId);
  const { size } = await stat(file).catch(() => ({ size: -1 }));
  if (size !== record.expectedBytes) {
    throw new UploadError("The upload is incomplete.", 409, Math.max(size, 0));
  }

  // What the file is comes from its own bytes.
  const handle = await open(file, "r");
  const head = Buffer.alloc(4);
  await handle.read(head, 0, 4, 0);
  await handle.close();
  if (!head.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    await rm(file, { force: true });
    await db
      .update(kbImports)
      .set({ status: "failed", error: "That file is not a zip archive.", finishedAt: new Date() })
      .where(eq(kbImports.id, importId));
    throw new UploadError("That file is not a zip archive.", 415);
  }

  await db.update(kbImports).set({ status: "running" }).where(eq(kbImports.id, importId));

  void importArchive({
    file,
    collectionId: record.collectionId,
    importId,
    actorId,
    category: record.category,
  })
    .catch(() => undefined) // Already recorded on the import.
    .finally(() => rm(file, { force: true }).catch(() => undefined));
}

export async function abandonUpload(importId: string): Promise<void> {
  const record = await getImport(importId);
  if (!record || record.status !== "uploading") return;

  await rm(pathFor(importId), { force: true });
  await db
    .update(kbImports)
    .set({ status: "failed", error: "The upload was cancelled.", finishedAt: new Date() })
    .where(eq(kbImports.id, importId));
}

/** Archives left behind by a process that stopped mid-import. */
export async function clearScratch(): Promise<void> {
  if (isWorkers()) return;
  await rm(scratch(), { recursive: true, force: true }).catch(() => undefined);
}
