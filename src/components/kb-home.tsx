import { createHash } from "node:crypto";
import Link from "next/link";
import type { Route } from "next";
import { BookOpen, ExternalLink } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { KbSort } from "@/components/kb-sort";
import { KbView, type KbViewKind } from "@/components/kb-view";
import { KbSection } from "@/components/kb-section";
import { ArticleList } from "@/components/kb-reactions";
import { KbResults } from "@/app/(app)/kb/kb-results";
import {
  COLLECTION_SORTS,
  collectionOrder,
  listCollections,
  searchKb,
  type KbReader,
} from "@/server/services/kb";
import { listFavorites, listHelpful, listRecent } from "@/server/services/kb-reactions";
import { plural } from "@/i18n/format";
import { getI18n } from "@/i18n/server";

export type KbHomeParams = {
  q?: string;
  collection?: string;
  cursor?: string;
  sort?: string;
  dir?: string;
  view?: string;
};

/** A short mark of what a section holds, so a fold can tell when it changed. */
function fingerprint(parts: (string | number | null | undefined)[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
}

/**
 * The knowledge base front page: search, the knowledge bases sorted and
 * shown as cards or a list, then the reader's favorites, the pages readers
 * found most helpful, and the pages that changed last. Drawn the same for a
 * signed-in reader and a visitor to the public site; `base` is where links
 * lead and `readerKey` is who is reading, when that is known.
 */
export async function KbHome({
  base,
  reader,
  readerKey,
  params,
  title,
  subtitle,
  emptyText,
}: {
  base: "/kb" | "/pub/kb";
  reader: KbReader;
  readerKey: string | null;
  params: KbHomeParams;
  title: string;
  subtitle?: string;
  emptyText: string;
}) {
  const q = params.q?.trim().slice(0, 200) ?? "";
  const chosen = /^[0-9a-f-]{36}$/i.test(params.collection ?? "") ? params.collection : undefined;
  const order = collectionOrder(params.sort, params.dir);
  const view: KbViewKind = params.view === "list" ? "list" : "cards";
  const browsing = q === "";
  const scope = base === "/kb" ? "app" : "pub";

  const [collections, results, helpful, recent, { locale, messages: t }] = await Promise.all([
    listCollections(reader, order),
    searchKb({ q, collectionId: chosen, cursor: params.cursor }, reader),
    browsing ? listHelpful(reader, 5) : [],
    browsing ? listRecent(reader, 10) : [],
    getI18n(),
  ]);
  const favorites = browsing && readerKey ? await listFavorites(readerKey, reader) : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-[var(--muted-foreground)]">{subtitle}</p>}
      </div>

      {collections.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">{emptyText}</p>
      ) : (
        <>
          <form className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Input
              name="q"
              type="search"
              defaultValue={q}
              placeholder={t.kb.placeholder}
              aria-label={t.kb.query}
              className="sm:max-w-sm"
            />
            {collections.length > 1 && (
              <select
                name="collection"
                defaultValue={chosen ?? ""}
                aria-label={t.kb.collection}
                className="h-10 rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                <option value="">{t.kb.anyCollection}</option>
                {collections.map((collection) => (
                  <option key={collection.id} value={collection.id}>
                    {collection.name}
                  </option>
                ))}
              </select>
            )}
            <Button type="submit">{t.kb.submit}</Button>
          </form>

          {browsing ? (
            <KbSection
              id={`${scope}.collections`}
              heading={t.kb.collections}
              fingerprint={fingerprint(
                collections.map((c) => `${c.id}:${c.articleCount}:${c.favorites}:${c.helpful}`),
              )}
              controls={
                <div className="flex flex-wrap items-center gap-3">
                  <KbSort scope="collections" sorts={COLLECTION_SORTS} sort={order.sort} dir={order.dir} />
                  <KbView view={view} />
                </div>
              }
            >
              <ul
                className={
                  view === "list"
                    ? "flex flex-col divide-y rounded-md border"
                    : "grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
                }
              >
                {collections.map((collection) => {
                  const meta = [
                    plural(collection.articleCount, t.units.article, t.units.articles, locale),
                    collection.favorites > 0 ? t.kb.favoriteCount(collection.favorites) : null,
                    collection.helpful !== null
                      ? `${collection.helpful}% ${t.kb.thumbsUp.toLowerCase()}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ");

                  return (
                    <li key={collection.id} className={view === "list" ? "flex" : "relative"}>
                      <Link
                        href={`${base}/${collection.id}` as Route}
                        className={
                          view === "list"
                            ? "flex min-w-0 flex-1 gap-3 px-4 py-3 transition-colors hover:bg-[var(--muted)]"
                            : "flex h-full gap-3 rounded-md border px-4 py-3 pr-10 transition-colors hover:bg-[var(--muted)]"
                        }
                      >
                        <BookOpen
                          className="mt-1 size-4 shrink-0 text-[var(--muted-foreground)]"
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium break-words">{collection.name}</span>
                          {collection.description && (
                            <span className="block text-sm text-[var(--muted-foreground)]">
                              {collection.description}
                            </span>
                          )}
                          <span className="block text-sm text-[var(--muted-foreground)]">{meta}</span>
                        </span>
                      </Link>
                      {collection.siteUrl && (
                        <a
                          href={collection.siteUrl}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          title={t.kb.openSite}
                          aria-label={`${t.kb.openSite}: ${collection.name}`}
                          className={
                            view === "list"
                              ? "mr-3 inline-flex size-9 shrink-0 items-center justify-center self-center rounded-md text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                              : "absolute top-2 right-2 inline-flex size-8 items-center justify-center rounded-md text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                          }
                        >
                          <ExternalLink className="size-4" aria-hidden />
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>
            </KbSection>
          ) : results.hits.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">{t.kb.noMatches(q)}</p>
          ) : (
            <>
              <p className="text-sm text-[var(--muted-foreground)]">
                {plural(results.hits.length, t.units.result, t.units.results, locale)}
                {results.nextCursor ? t.kb.onThisPage : ""}
              </p>

              <KbResults
                hits={results.hits}
                showCollection={!chosen && collections.length > 1}
                base={base}
                locale={locale}
                t={t}
              />

              {results.nextCursor && (
                <div>
                  <Link
                    href={{
                      pathname: base,
                      query: {
                        q,
                        ...(chosen ? { collection: chosen } : {}),
                        cursor: results.nextCursor,
                      },
                    }}
                    className="text-sm underline"
                  >
                    {t.kb.nextPage}
                  </Link>
                </div>
              )}
            </>
          )}

          {browsing && favorites !== null && (
            <KbSection
              id={`${scope}.favorites`}
              heading={t.kb.favorites}
              hint={t.kb.favoritesHint}
              fingerprint={fingerprint(favorites.map((a) => a.id))}
            >
              {favorites.length === 0 ? (
                <p className="text-sm text-[var(--muted-foreground)]">{t.kb.noFavorites}</p>
              ) : (
                <ArticleList articles={favorites} base={base} locale={locale} t={t} />
              )}
            </KbSection>
          )}

          {browsing && (
            <KbSection
              id={`${scope}.helpful`}
              heading={t.kb.helpfulPages}
              hint={t.kb.helpfulHint}
              fingerprint={fingerprint(helpful.map((a) => `${a.id}:${a.helpful}:${a.votes}`))}
            >
              {helpful.length === 0 ? (
                <p className="text-sm text-[var(--muted-foreground)]">{t.kb.noHelpful}</p>
              ) : (
                <ArticleList articles={helpful} base={base} locale={locale} t={t} />
              )}
            </KbSection>
          )}

          {browsing && recent.length > 0 && (
            <KbSection
              id={`${scope}.recent`}
              heading={t.kb.recentPages}
              hint={t.kb.recentHint}
              fingerprint={fingerprint(recent.map((a) => `${a.id}:${a.dateModified?.toISOString()}`))}
            >
              <ArticleList articles={recent} base={base} locale={locale} t={t} />
            </KbSection>
          )}

          {browsing && <p className="text-sm text-[var(--muted-foreground)]">{t.kb.hint}</p>}
        </>
      )}
    </div>
  );
}
