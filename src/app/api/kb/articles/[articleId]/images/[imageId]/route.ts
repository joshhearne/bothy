import { getCompanyScope, getCurrentUser } from "@/server/auth/session";
import { serveArticleImage } from "@/server/services/kb-images";

export const dynamic = "force-dynamic";

/**
 * A picture in a knowledge base article, for a reader who has signed in. It
 * is reached through the article: one the reader may not read, or that does
 * not show this picture, answers "not found".
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ articleId: string; imageId: string }> },
): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { articleId, imageId } = await params;
  return serveArticleImage(request, articleId, imageId, {
    scope: await getCompanyScope(user),
    via: "app",
  });
}
