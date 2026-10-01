import { notFound } from "next/navigation";
import { KbCollection, UNCATEGORIZED } from "@/components/kb-collection";
import { requirePublicReader } from "@/server/kb/public";
import {
  ARTICLE_SORTS,
  articleOrder,
  getCollection,
  listArticles,
  listCategories,
  listTypes,
  ARTICLE_TYPES as TYPES,
} from "@/server/services/kb";
import { getI18n } from "@/i18n/server";

export const dynamic = "force-dynamic";

export default async function PublicCollectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ collectionId: string }>;
  searchParams: Promise<{
    category?: string;
    subcategory?: string;
    cursor?: string;
    sort?: string;
    dir?: string;
    type?: string;
  }>;
}) {
  const reader = await requirePublicReader();
  const { collectionId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(collectionId)) notFound();

  const collection = await getCollection(collectionId, reader);
  if (!collection) notFound();

  const filter = await searchParams;
  const order = articleOrder(filter.sort, filter.dir);
  const type = (TYPES as readonly string[]).includes(filter.type ?? "")
    ? (filter.type as (typeof TYPES)[number])
    : undefined;
  const [categories, types, page, { locale, messages: t }] = await Promise.all([
    listCategories(collectionId, reader),
    listTypes(collectionId, reader),
    listArticles(
      {
        collectionId,
        category: filter.category && filter.category !== UNCATEGORIZED ? filter.category : undefined,
        uncategorized: filter.category === UNCATEGORIZED,
        subcategory: filter.subcategory || undefined,
        cursor: filter.cursor,
        ...order,
        ...(type ? { type } : {}),
      },
      reader,
    ),
    getI18n(),
  ]);

  return (
    <KbCollection
      collection={collection}
      categories={categories}
      types={types}
      articles={page.articles}
      nextCursor={page.nextCursor}
      filter={{
        ...(filter.category ? { category: filter.category === UNCATEGORIZED ? "" : filter.category } : {}),
        ...(filter.subcategory ? { subcategory: filter.subcategory } : {}),
        ...(type ? { type } : {}),
      }}
      order={{ ...order, sorts: ARTICLE_SORTS }}
      base="/pub/kb"
      locale={locale}
      t={t}
    />
  );
}
