import { notFound } from "next/navigation";
import { KbCollection } from "@/components/kb-collection";
import { requirePublicReader } from "@/server/kb/public";
import { getCollection, listArticles, listCategories } from "@/server/services/kb";
import { getI18n } from "@/i18n/server";

export const dynamic = "force-dynamic";

export default async function PublicCollectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ collectionId: string }>;
  searchParams: Promise<{ category?: string; subcategory?: string; cursor?: string }>;
}) {
  const reader = await requirePublicReader();
  const { collectionId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(collectionId)) notFound();

  const collection = await getCollection(collectionId, reader);
  if (!collection) notFound();

  const filter = await searchParams;
  const [categories, page, { locale, messages: t }] = await Promise.all([
    listCategories(collectionId, reader),
    listArticles(
      {
        collectionId,
        category: filter.category || undefined,
        subcategory: filter.subcategory || undefined,
        cursor: filter.cursor,
      },
      reader,
    ),
    getI18n(),
  ]);

  return (
    <KbCollection
      collection={collection}
      categories={categories}
      articles={page.articles}
      nextCursor={page.nextCursor}
      filter={{
        ...(filter.category ? { category: filter.category } : {}),
        ...(filter.subcategory ? { subcategory: filter.subcategory } : {}),
      }}
      base="/pub/kb"
      locale={locale}
      t={t}
    />
  );
}
