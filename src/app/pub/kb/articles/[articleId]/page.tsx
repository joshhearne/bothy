import { notFound } from "next/navigation";
import { KbArticle } from "@/components/kb-article";
import { requirePublicReader } from "@/server/kb/public";
import { getArticle } from "@/server/services/kb";
import { getI18n } from "@/i18n/server";

export const dynamic = "force-dynamic";

export default async function PublicArticlePage({
  params,
}: {
  params: Promise<{ articleId: string }>;
}) {
  const reader = await requirePublicReader();
  const { articleId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(articleId)) notFound();

  const article = await getArticle(articleId, reader);
  if (!article) notFound();

  const { locale, messages: t } = await getI18n();

  return (
    <KbArticle
      article={article}
      backHref={`/pub/kb/${article.collectionId}`}
      locale={locale}
      t={t}
    />
  );
}
