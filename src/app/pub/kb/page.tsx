import Link from "next/link";
import { BookOpen } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { KbSort } from "@/components/kb-sort";
import { KbView, type KbViewKind } from "@/components/kb-view";
import { ArticleList } from "@/components/kb-reactions";
import { publicIdentity } from "@/server/kb/identity";
import { requirePublicReader } from "@/server/kb/public";
import { COLLECTION_SORTS, collectionOrder, listCollections, searchKb } from "@/server/services/kb";
import { listFavorites, listHelpful, listRecent } from "@/server/services/kb-reactions";
import { plural } from "@/i18n/format";
import { getI18n } from "@/i18n/server";
import { KbResults } from "@/app/(app)/kb/kb-results";

export const dynamic = "force-dynamic";

export default async function PublicKbPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    collection?: string;
    cursor?: string;
    sort?: string;
    dir?: string;
    view?: string;
  }>;
}) {
  const reader = await requirePublicReader();
  const params = await searchParams;
  const q = params.q?.trim().slice(0, 200) ?? "";
  const chosen = /^[0-9a-f-]{36}$/i.test(params.collection ?? "") ? params.collection : undefined;
  const order = collectionOrder(params.sort, params.dir);
  // Cards unless this browser asked for a list.
  const view: KbViewKind = params.view === "list" ? "list" : "cards";
  const browsing = q === "";

  const [collections, results, identity, helpful, recent, { locale, messages: t }] =
    await Promise.all([
      listCollections(reader, order),
      searchKb({ q, collectionId: chosen, cursor: params.cursor }, reader),
      browsing ? publicIdentity() : null,
      browsing ? listHelpful(reader, 5) : [],
      browsing ? listRecent(reader, 10) : [],
      getI18n(),
    ]);
  const favorites = identity ? await listFavorites(identity.key, reader) : null;

  const section = (heading: string, hint: string, body: React.ReactNode) => (
    <section aria-label={heading} className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{heading}</h2>
        <p className="text-sm text-[var(--muted-foreground)]">{hint}</p>
      </div>
      {body}
    </section>
  );

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t.kb.title}</h1>

      {collections.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">{t.kb.publicEmpty}</p>
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
            <section aria-label={t.kb.collections} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold tracking-tight">{t.kb.collections}</h2>
                <div className="flex flex-wrap items-center gap-3">
                  <KbSort
                    scope="collections"
                    sorts={COLLECTION_SORTS}
                    sort={order.sort}
                    dir={order.dir}
                  />
                  <KbView view={view} />
                </div>
              </div>
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
                    <li key={collection.id}>
                      <Link
                        href={`/pub/kb/${collection.id}`}
                        className={
                          view === "list"
                            ? "flex gap-3 px-4 py-3 transition-colors hover:bg-[var(--muted)]"
                            : "flex h-full gap-3 rounded-md border px-4 py-3 transition-colors hover:bg-[var(--muted)]"
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
                    </li>
                  );
                })}
              </ul>
            </section>
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
                base="/pub/kb"
                locale={locale}
                t={t}
              />

              {results.nextCursor && (
                <div>
                  <Link
                    href={{
                      pathname: "/pub/kb",
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

          {browsing &&
            favorites !== null &&
            section(
              t.kb.favorites,
              t.kb.favoritesHint,
              favorites.length === 0 ? (
                <p className="text-sm text-[var(--muted-foreground)]">{t.kb.noFavorites}</p>
              ) : (
                <ArticleList articles={favorites} base="/pub/kb" locale={locale} t={t} />
              ),
            )}

          {browsing &&
            section(
              t.kb.helpfulPages,
              t.kb.helpfulHint,
              helpful.length === 0 ? (
                <p className="text-sm text-[var(--muted-foreground)]">{t.kb.noHelpful}</p>
              ) : (
                <ArticleList articles={helpful} base="/pub/kb" locale={locale} t={t} />
              ),
            )}

          {browsing &&
            recent.length > 0 &&
            section(
              t.kb.recentPages,
              t.kb.recentHint,
              <ArticleList articles={recent} base="/pub/kb" locale={locale} t={t} />,
            )}

          {browsing && <p className="text-sm text-[var(--muted-foreground)]">{t.kb.hint}</p>}
        </>
      )}
    </div>
  );
}
