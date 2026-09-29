import { z } from "zod";
import { refuse, requireAdminRequest } from "@/server/kb/admin-route";
import { completeUpload, UploadError } from "@/server/services/kb-upload";

export const dynamic = "force-dynamic";

/** Every piece has arrived: start the import and answer without waiting for it. */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await requireAdminRequest(request);
  if ("response" in guard) return guard.response;

  const id = z.uuid().safeParse((await context.params).id);
  if (!id.success) return refuse(404, "not_found", "No such upload");

  try {
    await completeUpload(id.data, guard.user.id);
    return Response.json({ status: "running" }, { status: 202, headers: { "Cache-Control": "no-store" } });
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
