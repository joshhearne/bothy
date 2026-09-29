import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ExternalLink } from "lucide-react";
import { requireScopedUser } from "@/server/auth/session";
import { getArticle } from "@/server/services/kb";
import { renderMarkdown } from "@/server/fields/render";
import { formatDateTime } from "@/i18n/format";
import { getI18n } from "@/i18n/server";

export const dynamic = "force-dynamic";

type Attachment = { name: string; extracted: boolean };

/** Attachments arrive as names, or as names with whether their text was read. */
function attachments(value: unknown): Attachment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): Attachment[] => {
    if (typeof item === "string") return [{ name: item, extracted: true }];
    if (typeof item === "object" && item !== null && typeof (item as { name?: unknown }).name === "string") {
      const entry = item as { name: string; extracted?: unknown };
      return [{ name: entry.name, extracted: entry.extracted !== false }];
    }
    return [];
  });
}

/**
 * An exported article usually opens with its own title as a heading. The page
 * already shows the title, so the repeat is left out of what is drawn — the
 * stored article keeps it.
 */
function withoutLeadingTitle(body: string, title: string): string {
  const match = /^\s*#\s+(.+?)\s*#*\s*(?:\n|$)/.exec(body);
  if (!match) return body;

  const same = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
  return same(match[1] ?? "") === same(title) ? body.slice(match[0].length) : body;
}

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ articleId: string }>;
}) {
  const { scope } = await requireScopedUser();
  const { articleId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(articleId)) notFound();

  const article = await getArticle(articleId, { scope, via: "app" });
  if (!article) notFound();

  const { locale, messages: t } = await getI18n();
  const unread = attachments(article.metadata.doc_attachments).filter((item) => !item.extracted);

  return (
    <article className="flex max-w-4xl flex-col gap-6">
      <header className="flex flex-col gap-3">
        <Link
          href={`/kb/${article.collectionId}`}
          className="inline-flex items-center gap-1 text-sm text-[var(--muted-foreground)] hover:underline"
        >
          <ChevronLeft className="size-4" aria-hidden />
          {t.kb.backTo(article.collectionName)}
        </Link>

        <h1 className="text-2xl font-semibold tracking-tight break-words">{article.title}</h1>

        <p className="text-sm text-[var(--muted-foreground)]">
          {[
            article.category,
            article.subcategory,
            article.externalId && article.sourceType !== "html"
              ? t.kb.articleId(article.externalId)
              : null,
            article.dateCreated ? t.kb.created(formatDateTime(article.dateCreated, locale)) : null,
            article.dateModified ? t.kb.modified(formatDateTime(article.dateModified, locale)) : null,
            t.kb.imported(formatDateTime(article.updatedAt, locale)),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>

        {article.sourceUrl && (
          <a
            href={article.sourceUrl}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="inline-flex max-w-full items-center gap-1.5 self-start rounded-md border px-3 py-1.5 text-sm hover:bg-[var(--muted)]"
          >
            <ExternalLink className="size-4 shrink-0" aria-hidden />
            <span className="shrink-0 font-medium">{t.kb.source}</span>
            <span className="truncate text-[var(--muted-foreground)]">{article.sourceUrl}</span>
          </a>
        )}
      </header>

      {unread.length > 0 && (
        <p role="note" className="rounded-md border px-3 py-2 text-sm">
          {t.kb.unextractedAttachments(unread.map((item) => item.name).join(", "))}
        </p>
      )}

      {article.extraction === "unextracted" ? (
        <p role="note" className="rounded-md border px-3 py-2 text-sm">
          {t.kb.unextractedBody}
        </p>
      ) : article.format === "markdown" ? (
        <div
          className="prose-editor kb-article min-w-0 text-sm break-words"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(withoutLeadingTitle(article.body, article.title)) }}
        />
      ) : (
        <pre className="min-w-0 font-sans text-sm break-words whitespace-pre-wrap">{article.body}</pre>
      )}
    </article>
  );
}
