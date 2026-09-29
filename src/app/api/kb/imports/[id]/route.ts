import { z } from "zod";
import { refuse, requireAdminRequest } from "@/server/kb/admin-route";
import { getImport } from "@/server/services/kb-import";
import {
  abandonUpload,
  appendPiece,
  UPLOAD_PIECE_BYTES,
  UploadError,
} from "@/server/services/kb-upload";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

const idSchema = z.uuid();

/** Where an import has got to. The page asks this while one is running. */
export async function GET(request: Request, context: Context): Promise<Response> {
  const guard = await requireAdminRequest(request);
  if ("response" in guard) return guard.response;

  const id = idSchema.safeParse((await context.params).id);
  const record = id.success ? await getImport(id.data) : null;
  if (!record) return refuse(404, "not_found", "No such import");

  return Response.json(
    {
      id: record.id,
      status: record.status,
      received_bytes: record.receivedBytes,
      expected_bytes: record.expectedBytes,
      total: record.total,
      added: record.added,
      updated: record.updated,
      skipped: record.skipped,
      failed: record.failed,
      unextracted: record.unextracted,
      ignored: record.ignored,
      images: record.images,
      used_manifest: record.usedManifest,
      failures: record.failures,
      error: record.error,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** One piece of the archive, as the raw body, starting at `offset`. */
export async function PUT(request: Request, context: Context): Promise<Response> {
  const guard = await requireAdminRequest(request);
  if ("response" in guard) return guard.response;

  const id = idSchema.safeParse((await context.params).id);
  if (!id.success) return refuse(404, "not_found", "No such upload");

  const offset = Number(new URL(request.url).searchParams.get("offset"));
  if (!Number.isInteger(offset) || offset < 0) return refuse(400, "invalid", "offset is required");

  // Refused on what the request says before any of it is read.
  if (Number(request.headers.get("content-length") ?? 0) > UPLOAD_PIECE_BYTES) {
    return refuse(413, "too_large", "That piece is too large");
  }

  try {
    const bytes = Buffer.from(await request.arrayBuffer());
    const received = await appendPiece(id.data, offset, bytes);
    return Response.json({ received_bytes: received }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof UploadError) {
      return refuse(
        error.status,
        "upload",
        error.message,
        error.offset === undefined ? {} : { received_bytes: error.offset },
      );
    }
    throw error;
  }
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  const guard = await requireAdminRequest(request);
  if ("response" in guard) return guard.response;

  const id = idSchema.safeParse((await context.params).id);
  if (id.success) await abandonUpload(id.data);
  return new Response(null, { status: 204 });
}
