import { admitPublicImageReader, TooManyRequestsError } from "@/server/kb/public";
import { serveArticleImage } from "@/server/services/kb-images";

export const dynamic = "force-dynamic";

/**
 * A picture in an article on the public site. The visitor is admitted as for
 * any other page there, and the picture is theirs only through an article
 * that is: one held back takes its pictures with it.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ articleId: string; imageId: string }> },
): Promise<Response> {
  let reader;
  try {
    reader = await admitPublicImageReader();
  } catch (error) {
    if (error instanceof TooManyRequestsError) {
      return new Response("Too many requests", { status: 429, headers: { "Retry-After": "60" } });
    }
    throw error;
  }
  if (!reader) return new Response("Not found", { status: 404 });

  const { articleId, imageId } = await params;
  return serveArticleImage(request, articleId, imageId, reader);
}
