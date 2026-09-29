import { ZodError } from "zod";
import { refuse, requireAdminRequest } from "@/server/kb/admin-route";
import { startUpload, startUploadSchema, UploadError } from "@/server/services/kb-upload";

export const dynamic = "force-dynamic";

/** Announces an upload: what it is called, how large it is, where it goes. */
export async function POST(request: Request): Promise<Response> {
  const guard = await requireAdminRequest(request);
  if ("response" in guard) return guard.response;

  try {
    const input = startUploadSchema.parse(await request.json().catch(() => null));
    const upload = await startUpload(input, guard.user.id);
    return Response.json(upload, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return refuse(400, "invalid", "That is not a valid upload");
    if (error instanceof UploadError) return refuse(error.status, "upload", error.message);
    throw error;
  }
}
