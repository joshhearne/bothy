import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { requireScopedUser } from "@/server/auth/session";
import {
  getCollection,
  listArticles,
  listCategories,
  type KbReader,
} from "@/server/services/kb";
import { formatDateTime, formatNumber, plural } from "@/i18n/format";
import { getI18n } from "@/i18n/server";

export const dynamic = "force-dynamic";

/** One collection: its categories beside its articles, which scroll on their own. */
export default async function CollectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ collectionId: string }>;
  searchParams: Promise<{ category?: string; subcategory?: string; cursor?: string }>;
}) {
  const { scope } = await requireScopedUser();
  const reader: KbReader = { scope, via: "app" };
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

  const grouped = new Map<string, { total: number; children: { name: string; articles: number }[] }>();
  for (const row of categories) {
    const name = row.category ?? "";
    const group = grouped.get(name) ?? { total: 0, children: [] };
    group.total += row.articles;
    if (row.subcategory) group.children.push({ name: row.subcategory, articles: row.articles });
    grouped.set(name, group);
  }

  const href = (category?: string, subcategory?: string) => ({
    pathname: `/kb/${collectionId}`,
    query: {
      ...(category !== undefined ? { category } : {}),
      ...(subcategory ? { subcategory } : {}),
    },
  });

  const linkClass = (active: boolean) =>
    cn(
      "flex items-center justify-between gap-2 rounded-md px-2 py-1 text-sm",
      active
        ? "bg-[var(--primary)] font-medium text-[var(--primary-foreground)]"
        : "text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]",
    );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link
          href="/kb"
          className="inline-flex items-center gap-1 text-sm text-[var(--muted-foreground)] hover:underline"
        >
          <ChevronLeft className="size-4" aria-hidden />
          {t.kb.backTo(t.kb.title)}
        </Link>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight break-words">{collection.name}</h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            {[
              collection.description,
              plural(collection.articleCount, t.units.article, t.units.articles, locale),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>

        <form action="/kb" className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input type="hidden" name="collection" value={collectionId} />
          <Input
            name="q"
            type="search"
            placeholder={t.kb.placeholder}
            aria-label={t.kb.query}
            className="sm:max-w-sm"
          />
          <Button type="submit">{t.kb.submit}</Button>
        </form>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        <nav
          aria-label={t.kb.categories}
          className="lg:sticky lg:top-20 lg:max-h-[calc(100dvh-7rem)] lg:w-64 lg:shrink-0 lg:overflow-y-auto"
        >
          <details className="lg:hidden" open={false}>
            <summary className="cursor-pointer rounded-md border px-3 py-2 text-sm font-medium">
              {filter.subcategory ?? filter.category ?? t.kb.categories}
            </summary>
            {categoryList()}
          </details>
          <div className="hidden lg:block">
            {categoryList()}
          </div>
        </nav>

        <div className="min-w-0 flex-1">
          {page.articles.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">{t.kb.noArticles}</p>
          ) : (
            <ul className="flex flex-col divide-y rounded-md border">
              {page.articles.map((article) => (
                <li key={article.id} className="px-4 py-3">
                  <Link
                    href={`/kb/articles/${article.id}`}
                    className="font-medium break-words hover:underline"
                  >
                    {article.title}
                  </Link>
                  <p className="text-sm text-[var(--muted-foreground)]">
                    {[
                      article.category,
                      article.subcategory,
                      article.dateModified
                        ? t.kb.modified(formatDateTime(article.dateModified, locale))
                        : null,
                      article.extraction === "unextracted" ? t.kb.unextracted : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {page.nextCursor && (
            <div className="mt-4">
              <Link
                href={{
                  pathname: `/kb/${collectionId}`,
                  query: {
                    ...(filter.category ? { category: filter.category } : {}),
                    ...(filter.subcategory ? { subcategory: filter.subcategory } : {}),
                    cursor: page.nextCursor,
                  },
                }}
                className="text-sm underline"
              >
                {t.kb.nextPage}
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  function categoryList() {
    return (
      <ul className="mt-2 flex flex-col gap-0.5 lg:mt-0">
        <li>
          <Link href={href()} className={linkClass(!filter.category && !filter.subcategory)}>
            <span>{t.kb.allCategories}</span>
            <span className="text-xs">{formatNumber(collection?.articleCount ?? 0, locale)}</span>
          </Link>
        </li>
        {[...grouped.entries()].map(([name, group]) => (
          <li key={name}>
            <Link
              href={href(name)}
              className={linkClass(filter.category === name && !filter.subcategory)}
            >
              <span className="min-w-0 truncate">{name === "" ? t.kb.uncategorized : name}</span>
              <span className="text-xs">{formatNumber(group.total, locale)}</span>
            </Link>
            {filter.category === name && group.children.length > 0 && (
              <ul className="ml-3 flex flex-col gap-0.5 border-l pl-2">
                {group.children.map((child) => (
                  <li key={child.name}>
                    <Link
                      href={href(name, child.name)}
                      className={linkClass(filter.subcategory === child.name)}
                    >
                      <span className="min-w-0 truncate">{child.name}</span>
                      <span className="text-xs">{formatNumber(child.articles, locale)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    );
  }
}
