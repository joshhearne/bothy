import Link from "next/link";
import type { Route } from "next";
import { ChevronLeft, ListChecks, Plus } from "lucide-react";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { KbSort } from "@/components/kb-sort";
import { CopyLink } from "@/components/ui/copy-link";
import { ExternalLink } from "lucide-react";
import { reactionSummary } from "@/components/kb-reactions";
import type {
  ArticleSummary,
  ArticleType,
  CategoryCount,
  CollectionRow,
  TypeCount,
} from "@/server/services/kb";
import { formatDateTime, formatNumber, plural } from "@/i18n/format";
import type { Messages } from "@/i18n";
import type { Locale } from "@/i18n/locales";

export type CollectionFilter = { category?: string; subcategory?: string; type?: ArticleType };

/** The address of the articles with no category: `category` alone would read as none chosen. */
export const UNCATEGORIZED = "~";

/** How the articles are ordered, when the reader may choose. */
export type CollectionOrder = { sort: string; dir: "asc" | "desc"; sorts: readonly string[] };

/**
 * One collection: its categories beside its articles, which scroll on their
 * own. Drawn the same for a signed-in reader and for the public site; `base`
 * is where its links lead.
 */
export function KbCollection({
  collection,
  categories,
  types = [],
  articles,
  nextCursor,
  filter,
  order,
  publicHref,
  canWrite = false,
  base,
  locale,
  t,
}: {
  collection: CollectionRow;
  categories: CategoryCount[];
  /** What the articles came from; a filter only when there is more than one kind. */
  types?: TypeCount[];
  articles: ArticleSummary[];
  nextCursor: string | null;
  filter: CollectionFilter;
  order?: CollectionOrder;
  /** Where a public reader would open this, when they could. */
  publicHref?: string | null;
  /** The reader may write to this collection: a "New article" way in is shown. */
  canWrite?: boolean;
  base: string;
  locale: Locale;
  t: Messages;
}) {
  const grouped = new Map<string, { total: number; children: { name: string; articles: number }[] }>();
  for (const row of categories) {
    const name = row.category ?? "";
    const group = grouped.get(name) ?? { total: 0, children: [] };
    group.total += row.articles;
    if (row.subcategory) group.children.push({ name: row.subcategory, articles: row.articles });
    grouped.set(name, group);
  }

  const path = `${base}/${collection.id}` as Route;
  // `type` null takes the kind filter off; left out, the current one stays.
  const href = (
    category?: string,
    subcategory?: string,
    cursor?: string,
    type: ArticleType | null | undefined = filter.type,
  ) => ({
    pathname: path,
    query: {
      ...(category !== undefined ? { category } : {}),
      ...(subcategory ? { subcategory } : {}),
      ...(cursor ? { cursor } : {}),
      ...(type ? { type } : {}),
      ...(order ? { sort: order.sort, dir: order.dir } : {}),
    },
  });

  const linkClass = (active: boolean) =>
    cn(
      "flex items-center justify-between gap-2 rounded-md px-2 py-1 text-sm",
      active
        ? "bg-[var(--primary)] font-medium text-[var(--primary-foreground)]"
        : "text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]",
    );

  const typeList =
    types.length > 1 ? (
      <ul aria-label={t.kb.types} className="mb-2 flex flex-col gap-0.5 border-b pb-2">
        {types.map((row) => (
          <li key={row.type}>
            <Link
              href={href(filter.category, filter.subcategory, undefined, filter.type === row.type ? null : row.type)}
              className={linkClass(filter.type === row.type)}
              aria-pressed={filter.type === row.type}
            >
              <span className="min-w-0 truncate">{t.kb.typeNames[row.type](row.articles)}</span>
            </Link>
          </li>
        ))}
      </ul>
    ) : null;

  const categoryList = (
    <ul className="mt-2 flex flex-col gap-0.5 lg:mt-0">
      <li>
        <Link href={href()} className={linkClass(!filter.category && !filter.subcategory)}>
          <span>{t.kb.allCategories}</span>
          <span className="text-xs">{formatNumber(collection.articleCount, locale)}</span>
        </Link>
      </li>
      {[...grouped.entries()].map(([name, group]) => (
        <li key={name}>
          <Link
            href={href(name === "" ? UNCATEGORIZED : name)}
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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link
          href={base as Route}
          className="inline-flex items-center gap-1 text-sm text-[var(--muted-foreground)] hover:underline"
        >
          <ChevronLeft className="size-4" aria-hidden />
          {t.kb.backTo(t.kb.title)}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
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
          <div className="flex flex-wrap items-center gap-2">
            {collection.siteUrl && (
              <a
                href={collection.siteUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="inline-flex max-w-full items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-[var(--muted)]"
              >
                <ExternalLink className="size-4 shrink-0" aria-hidden />
                <span className="shrink-0 font-medium">{t.kb.openSite}</span>
                <span className="truncate text-[var(--muted-foreground)]">
                  {collection.siteUrl.replace(/^https?:\/\//, "")}
                </span>
              </a>
            )}
            {publicHref && (
              <CopyLink href={publicHref} label={t.kb.publicLink} copiedLabel={t.kb.publicLinkCopied} />
            )}
            {canWrite && (
              <Link
                href={`${base}/articles/new?collection=${collection.id}` as Route}
                className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-[var(--muted)]"
              >
                <Plus className="size-4 shrink-0" aria-hidden />
                {t.kb.newArticle}
              </Link>
            )}
          </div>
        </div>

        <form action={base} className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input type="hidden" name="collection" value={collection.id} />
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
          className="lg:sticky lg:top-20 lg:max-h-[calc(100dvh-7rem)] lg:w-64 lg:shrink-0 lg:overflow-y-auto lg:pr-3 lg:[scrollbar-gutter:stable]"
        >
          <details className="lg:hidden">
            <summary className="cursor-pointer rounded-md border px-3 py-2 text-sm font-medium">
              {filter.subcategory ?? filter.category ?? t.kb.categories}
            </summary>
            {typeList}
            {categoryList}
          </details>
          <div className="hidden lg:block">
            {typeList}
            {categoryList}
          </div>
        </nav>

        <div className="min-w-0 flex-1">
          {order && articles.length > 0 && (
            <div className="mb-3">
              <KbSort scope="articles" sorts={order.sorts} sort={order.sort} dir={order.dir} />
            </div>
          )}
          {articles.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">{t.kb.noArticles}</p>
          ) : (
            <ul className="flex flex-col divide-y rounded-md border">
              {articles.map((article) => (
                <li key={article.id} className="px-4 py-3">
                  <Link
                    href={`${base}/articles/${article.id}` as Route}
                    className="font-medium break-words hover:underline"
                  >
                    {article.title}
                  </Link>
                  {article.kind === "runbook" && (
                    <Chip tone="blue" icon={ListChecks} className="ml-2 align-middle">
                      {t.kb.runbook}
                    </Chip>
                  )}
                  <p className="text-sm text-[var(--muted-foreground)]">
                    {[
                      article.category,
                      article.subcategory,
                      article.dateModified
                        ? t.kb.modified(formatDateTime(article.dateModified, locale))
                        : null,
                      article.extraction === "unextracted" ? t.kb.unextracted : null,
                      ...reactionSummary(article, t),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {nextCursor && (
            <div className="mt-4">
              <Link
                href={href(filter.category, filter.subcategory, nextCursor)}
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
}
