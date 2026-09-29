import Link from "next/link";
import type { Route } from "next";
import { BookOpen, ExternalLink } from "lucide-react";
import { snippetToSegments } from "@/server/services/search";
import type { KbHit } from "@/server/services/kb";
import { formatDateTime } from "@/i18n/format";
import type { Messages } from "@/i18n";
import type { Locale } from "@/i18n/locales";

/** Search hits: the article, the passage that matched, and where it came from. */
export function KbResults({
  hits,
  showCollection,
  base = "/kb",
  locale,
  t,
}: {
  hits: KbHit[];
  showCollection: boolean;
  /** Where article links lead: the interface, or the public site. */
  base?: string;
  locale: Locale;
  t: Messages;
}) {
  return (
    <ul className="flex flex-col gap-2">
      {hits.map((hit) => (
        <li key={hit.articleId} className="flex gap-3 rounded-md border px-4 py-3">
          <BookOpen className="mt-1 size-4 shrink-0 text-[var(--muted-foreground)]" aria-hidden />
          <div className="min-w-0 flex-1">
            <Link
              href={`${base}/articles/${hit.articleId}` as Route}
              className="font-medium break-words hover:underline"
            >
              {hit.title}
            </Link>
            <p className="text-sm text-[var(--muted-foreground)]">
              {[
                showCollection ? hit.collectionName : null,
                hit.category,
                hit.subcategory,
                hit.dateModified ? t.kb.modified(formatDateTime(hit.dateModified, locale)) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>

            {hit.snippet && (
              <p className="mt-1 text-sm break-words">
                {snippetToSegments(hit.snippet).map((segment, index) =>
                  segment.match ? (
                    <mark
                      key={index}
                      className="rounded bg-[var(--selection)] px-0.5 text-[var(--foreground)]"
                    >
                      {segment.text}
                    </mark>
                  ) : (
                    <span key={index}>{segment.text}</span>
                  ),
                )}
              </p>
            )}

            {hit.sourceUrl && (
              <a
                href={hit.sourceUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="mt-1 inline-flex max-w-full items-center gap-1 text-xs text-[var(--muted-foreground)] underline"
              >
                <ExternalLink className="size-3 shrink-0" aria-hidden />
                <span className="truncate">{hit.sourceUrl}</span>
              </a>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
