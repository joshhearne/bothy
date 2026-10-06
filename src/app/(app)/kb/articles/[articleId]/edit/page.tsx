import { notFound } from "next/navigation";
import { requireScopedUser } from "@/server/auth/session";
import { getArticle } from "@/server/services/kb";
import { userMayWrite } from "@/server/services/kb-write";
import { getI18n } from "@/i18n/server";
import { KbEditor } from "../../../kb-editor";

export const dynamic = "force-dynamic";

export default async function EditArticlePage({ params }: { params: Promise<{ articleId: string }> }) {
  const { user, scope } = await requireScopedUser();
  const { articleId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(articleId)) notFound();
  const article = await getArticle(articleId, { scope, via: "app", userId: user.id });
  // Only an article with a name of its own can be written again under it.
  if (!article || !article.externalId || article.format !== "markdown") notFound();
  if (!(await userMayWrite(user, article.collectionId))) notFound();
  const { messages: t } = await getI18n();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm text-[var(--muted-foreground)]">{article.collectionName}</p>
        <h1 className="text-2xl font-semibold tracking-tight">{t.kb.editor.editTitle}</h1>
      </div>
      <KbEditor
        backHref={`/kb/articles/${article.id}`}
        values={{
          collectionId: article.collectionId,
          externalId: article.externalId,
          title: article.title,
          category: article.category ?? "",
          subcategory: article.subcategory ?? "",
          kind: article.kind,
          internalOnly: article.hiddenBy === "manual",
          body: article.body,
          steps: article.steps,
          imported: article.sourcePath !== null || article.sourceType !== "md",
        }}
      />
    </div>
  );
}
