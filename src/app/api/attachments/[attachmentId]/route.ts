import { getCompanyScope, getCurrentUser } from "@/server/auth/session";
import { getAttachment } from "@/server/services/attachments";
import { getStorage } from "@/server/storage";
import { contentDisposition } from "@/server/storage/filename";

export const dynamic = "force-dynamic";

/**
 * Downloads an attachment. Always served as an attachment with nosniff, so an
 * uploaded HTML file can never execute on this origin.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ attachmentId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { attachmentId } = await params;
  const attachment = await getAttachment(attachmentId, await getCompanyScope(user));
  if (!attachment) return new Response("Not found", { status: 404 });

  let body: Buffer;
  try {
    const storage = await getStorage();
    body = await storage.get(attachment.storageKey);
  } catch {
    return new Response("Attachment is missing from storage", { status: 502 });
  }

  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Length": String(body.byteLength),
      "Content-Disposition": contentDisposition(attachment.filename),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, no-store",
    },
  });
}
