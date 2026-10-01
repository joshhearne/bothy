import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { CopyLink } from "@/components/ui/copy-link";
import { KbArticle } from "@/components/kb-article";
import { ReactionBar } from "@/components/kb-reactions";
import { requireScopedUser } from "@/server/auth/session";
import { readerKey } from "@/server/kb/identity";
import { publicAddressFor } from "@/server/kb/share";
import { getArticle } from "@/server/services/kb";
import { withImages } from "@/server/services/kb-images";
import { readerReaction } from "@/server/services/kb-reactions";
import { getI18n } from "@/i18n/server";
import { setArticlePublicHiddenAction, toggleFavoriteAction, voteAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ articleId: string }>;
}) {
  const { user, scope } = await requireScopedUser();
  const { articleId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(articleId)) notFound();

  const found = await getArticle(articleId, { scope, via: "app" });
  if (!found) notFound();
  const key = readerKey(user.email);
  const [article, reaction, publicHref, { locale, messages: t }] = await Promise.all([
    withImages(found, `/api/kb/articles/${found.id}/images`),
    readerReaction(key, found.id),
    publicAddressFor(found),
    getI18n(),
  ]);

  return (
    <KbArticle
      article={article}
      backHref={`/kb/${article.collectionId}`}
      originalHref={`/api/kb/articles/${article.id}/original`}
      locale={locale}
      t={t}
      actions={
        <>
          {publicHref && (
            <CopyLink href={publicHref} label={t.kb.publicLink} copiedLabel={t.kb.publicLinkCopied} />
          )}
          {
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
            ) : null
          }
          <div className="basis-full">
            <ReactionBar
              article={article}
              reaction={reaction}
              toggleFavorite={toggleFavoriteAction}
              vote={voteAction}
              t={t}
            />
          </div>
        </>
      }
    />
  );
}
