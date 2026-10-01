import { admitPublicImageReader, TooManyRequestsError } from "@/server/kb/public";
import { serveArticleOriginal } from "@/server/services/kb-images";

export const dynamic = "force-dynamic";

/** The document behind an article on the public site, admitted as any page there is. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ articleId: string }> },
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
  const { articleId } = await params;
  return serveArticleOriginal(request, articleId, reader);
}
