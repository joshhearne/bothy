import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { KbArticle } from "@/components/kb-article";
import { requireScopedUser } from "@/server/auth/session";
import { getArticle } from "@/server/services/kb";
import { getI18n } from "@/i18n/server";
import { setArticlePublicHiddenAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ articleId: string }>;
}) {
  const { user, scope } = await requireScopedUser();
  const { articleId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(articleId)) notFound();

  const article = await getArticle(articleId, { scope, via: "app" });
  if (!article) notFound();

  const { locale, messages: t } = await getI18n();

  return (
    <KbArticle
      article={article}
      backHref={`/kb/${article.collectionId}`}
      locale={locale}
      t={t}
      actions={
        // Only worth saying where the collection is on the public site at all.
        user.role === "admin" && article.collectionPublic ? (
          <form action={setArticlePublicHiddenAction} className="flex items-center gap-2">
            <input type="hidden" name="id" value={article.id} />
            {!article.publicHidden && <input type="hidden" name="hidden" value="on" />}
            <span className="text-xs text-[var(--muted-foreground)]">
              {article.publicHidden ? t.kb.withheld : t.kb.onPublicSite}
            </span>
            <Button type="submit" variant="outline" size="sm">
              {article.publicHidden ? t.kb.publish : t.kb.withhold}
            </Button>
          </form>
        ) : undefined
      }
    />
  );
}
