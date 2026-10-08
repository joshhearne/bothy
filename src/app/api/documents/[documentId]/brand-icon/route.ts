import { getCompanyScope, getCurrentUser } from "@/server/auth/session";
import { NotFoundError } from "@/server/services/errors";
import { brandIconFor, fetchBrandIcon } from "@/server/services/company-brand";

export const dynamic = "force-dynamic";

/**
 * One of the icons a domain record's website offered, drawn for the people
 * who may read the record. Fetched here, the safe way, rather than hotlinked:
 * the page never asks a browser to call a client's site, and the bytes are
 * checked to be an image before they are served as one. Only an icon the
 * record found can be asked for, by its index, never an address.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ documentId: string }> },
): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { documentId } = await params;
  const index = Number(new URL(request.url).searchParams.get("i") ?? "");
  if (!Number.isInteger(index) || index < 0 || index > 64) {
    return new Response("Not found", { status: 404 });
  }

  let icon;
  try {
    icon = await brandIconFor(documentId, index, await getCompanyScope(user));
  } catch (err) {
    if (err instanceof NotFoundError)
      return new Response("Not found", { status: 404 });
    throw err;
  }
  if (!icon) return new Response("Not found", { status: 404 });

  try {
    const fetched = await fetchBrandIcon(icon);
    return new Response(new Uint8Array(fetched.bytes), {
      headers: {
        "Content-Type": fetched.mime,
        "Content-Length": String(fetched.bytes.byteLength),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    // Not an image we draw, too big, or unreachable: an empty frame, not an error page.
    return new Response("Not found", { status: 404 });
  }
}
