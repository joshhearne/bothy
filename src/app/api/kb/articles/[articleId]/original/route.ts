import { getCompanyScope, getCurrentUser } from "@/server/auth/session";
import { serveArticleOriginal } from "@/server/services/kb-images";

export const dynamic = "force-dynamic";

/** The document a knowledge base article was made from, for a reader who has signed in. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ articleId: string }> },
): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { articleId } = await params;
  return serveArticleOriginal(request, articleId, { scope: await getCompanyScope(user), via: "app", userId: user.id });
}
