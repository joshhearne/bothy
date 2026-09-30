import { notFound } from "next/navigation";
import { KbCollection } from "@/components/kb-collection";
import { requireScopedUser } from "@/server/auth/session";
import { publicAddressFor } from "@/server/kb/share";
import {
  ARTICLE_SORTS,
  articleOrder,
  getCollection,
  listArticles,
  listCategories,
  type KbReader,
} from "@/server/services/kb";
import { getI18n } from "@/i18n/server";

export const dynamic = "force-dynamic";

export default async function CollectionPage({
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
  }>;
}) {
  const { scope } = await requireScopedUser();
  const reader: KbReader = { scope, via: "app" };
  const { collectionId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(collectionId)) notFound();

  const collection = await getCollection(collectionId, reader);
  if (!collection) notFound();

  const filter = await searchParams;
  const order = articleOrder(filter.sort, filter.dir);
  const [categories, page, publicHref, { locale, messages: t }] = await Promise.all([
    listCategories(collectionId, reader),
    listArticles(
      {
        collectionId,
        category: filter.category || undefined,
        subcategory: filter.subcategory || undefined,
        cursor: filter.cursor,
        ...order,
      },
      reader,
    ),
    publicAddressFor({ id: collectionId, collectionPublic: collection.publicAccess, kind: "collection" }),
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
      order={{ ...order, sorts: ARTICLE_SORTS }}
      publicHref={publicHref}
      base="/kb"
      locale={locale}
      t={t}
    />
  );
}
