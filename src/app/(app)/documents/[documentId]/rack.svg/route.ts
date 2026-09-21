import { getCompanyScope, getCurrentUser } from "@/server/auth/session";
import { blocksFor, getRackView } from "@/server/services/racks";
import { renderRackSvg, type RackFace } from "@/server/racks/svg";
import { NotFoundError } from "@/server/services/errors";

export const dynamic = "force-dynamic";

/**
 * The elevation as a file: the same drawing the page shows, for printing or
 * dropping into a handover pack. One face per request.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ documentId: string }> },
): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { documentId } = await params;
  const face: RackFace = new URL(request.url).searchParams.get("face") === "rear" ? "rear" : "front";

  let view;
  try {
    view = await getRackView(documentId, await getCompanyScope(user));
  } catch (err) {
    if (err instanceof NotFoundError) return new Response("Not found", { status: 404 });
    throw err;
  }
  if (!view) return new Response("Not found", { status: 404 });

  const svg = renderRackSvg({
    name: view.name,
    totalU: view.totalU,
    numbering: view.numbering,
    face,
    blocks: blocksFor(view, face),
  });

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      // It names a client's equipment, so it is nobody's to cache but the reader's.
      "Cache-Control": "private, no-store",
      "Content-Disposition": `inline; filename="rack-${face}.svg"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
