import Link from "next/link";
import { BookOpen } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { requirePublicReader } from "@/server/kb/public";
import { listCollections, searchKb } from "@/server/services/kb";
import { plural } from "@/i18n/format";
import { getI18n } from "@/i18n/server";
import { KbResults } from "@/app/(app)/kb/kb-results";

export const dynamic = "force-dynamic";

export default async function PublicKbPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; collection?: string; cursor?: string }>;
}) {
  const reader = await requirePublicReader();
  const params = await searchParams;
  const q = params.q?.trim().slice(0, 200) ?? "";
  const chosen = /^[0-9a-f-]{36}$/i.test(params.collection ?? "") ? params.collection : undefined;

  const [collections, results, { locale, messages: t }] = await Promise.all([
    listCollections(reader),
    searchKb({ q, collectionId: chosen, cursor: params.cursor }, reader),
    getI18n(),
  ]);

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

          {q === "" ? (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {collections.map((collection) => (
                <li key={collection.id}>
                  <Link
                    href={`/pub/kb/${collection.id}`}
                    className="flex h-full gap-3 rounded-md border px-4 py-3 transition-colors hover:bg-[var(--muted)]"
                  >
                    <BookOpen
                      className="mt-1 size-4 shrink-0 text-[var(--muted-foreground)]"
                      aria-hidden
                    />
                    <span className="min-w-0">
                      <span className="block font-medium break-words">{collection.name}</span>
                      {collection.description && (
                        <span className="block text-sm text-[var(--muted-foreground)]">
                          {collection.description}
                        </span>
                      )}
                      <span className="block text-sm text-[var(--muted-foreground)]">
                        {plural(collection.articleCount, t.units.article, t.units.articles, locale)}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
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

          {q === "" && <p className="text-sm text-[var(--muted-foreground)]">{t.kb.hint}</p>}
        </>
      )}
    </div>
  );
}
