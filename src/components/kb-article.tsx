import Link from "next/link";
import type { Route } from "next";
import { ChevronLeft, ExternalLink, FileText, ListChecks } from "lucide-react";
import { Chip } from "@/components/ui/chip";
import { RunbookRun, RunbookSteps, type RenderedStep } from "@/components/kb-runbook-steps";
import { deriveRunbook, type RunbookStep } from "@/server/kb/runbook";
import { renderMarkdown } from "@/server/fields/render";
import { outlineHtml } from "@/server/kb/outline";
import { embedVideos } from "@/server/kb/video";
import { KbOutline } from "@/components/kb-outline";
import type { ArticleDetail } from "@/server/services/kb";
import { originalOf } from "@/server/services/kb-import";
import { formatBytes, formatDateTime } from "@/i18n/format";
import type { Messages } from "@/i18n";
import type { Locale } from "@/i18n/locales";

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

/**
 * One article, as a signed-in reader and a visitor to the public site both
 * see it. What differs between them is where "back" goes and what sits beside
 * the title, which the page supplies.
 */
export function KbArticle({
  article,
  backHref,
  originalHref,
  actions,
  locale,
  t,
}: {
  article: ArticleDetail;
  backHref: string;
  /** Where the document the article was made from is served, when it was kept. */
  originalHref?: string;
  actions?: React.ReactNode;
  locale: Locale;
  t: Messages;
}) {
  const unread = attachments(article.metadata.doc_attachments).filter((item) => !item.extracted);
  const original = originalHref ? originalOf(article.metadata) : null;
  const markdown = article.extraction !== "unextracted" && article.format === "markdown";
  const runbook = markdown && article.kind === "runbook" ? deriveRunbook(article.body, article.steps) : null;

  // A runbook is drawn by turns: prose, a checklist, prose again. The outline
  // is read across every piece of prose at once, so its ids are on the
  // headings that are drawn; a marker keeps the pieces apart until then.
  const MARK = "<!--runbook-steps-->";
  const source = runbook
    ? runbook.segments
        .map((segment, index) =>
          segment.kind === "markdown"
            ? embedVideos(renderMarkdown(index === 0 ? withoutLeadingTitle(segment.text, article.title) : segment.text))
            : MARK,
        )
        .join("")
    : markdown
      ? embedVideos(renderMarkdown(withoutLeadingTitle(article.body, article.title)))
      : null;
  const drawn = source !== null ? outlineHtml(source) : null;
  const rendered = (step: RunbookStep): RenderedStep => ({
    id: step.id,
    html: renderMarkdown(step.text).replace(/^<p>([\s\S]*)<\/p>\s*$/, "$1"),
    noteHtml: step.note ? embedVideos(renderMarkdown(step.note)) : null,
    canned: step.canned ?? null,
  });
  const pieces =
    runbook && drawn
      ? (() => {
          const prose = drawn.html.split(MARK);
          let at = 0;
          return runbook.segments.map((segment) =>
            segment.kind === "markdown"
              ? { kind: "html" as const, html: prose[at++] ?? "" }
              : { kind: "steps" as const, from: segment.from, steps: runbook.steps.slice(segment.from, segment.to).map(rendered) },
          );
        })()
      : null;

  return (
    <div className="flex items-start gap-8">
      <article className="flex min-w-0 max-w-4xl flex-1 flex-col gap-6">
        <header className="flex flex-col gap-3">
          <Link
            href={backHref as Route}
            className="inline-flex items-center gap-1 text-sm text-[var(--muted-foreground)] hover:underline"
          >
            <ChevronLeft className="size-4" aria-hidden />
            {t.kb.backTo(article.collectionName)}
          </Link>

          <h1 className="text-2xl font-semibold tracking-tight break-words">
            {article.title}
            {article.kind === "runbook" && (
              <Chip tone="blue" icon={ListChecks} className="ml-3 align-middle text-xs">
                {t.kb.runbook}
              </Chip>
            )}
          </h1>

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

          <div className="flex flex-wrap items-center gap-3">
            {article.sourceUrl && (
              <a
                href={article.sourceUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="inline-flex max-w-full items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-[var(--muted)]"
              >
                <ExternalLink className="size-4 shrink-0" aria-hidden />
                <span className="shrink-0 font-medium">{t.kb.source}</span>
                <span className="truncate text-[var(--muted-foreground)]">{article.sourceUrl}</span>
              </a>
            )}
            {original && (
              <a
                href={originalHref}
                target="_blank"
                rel="noopener noreferrer"
                className={
                  "inline-flex max-w-full items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-[var(--muted)]" +
                  (original.mime === "application/pdf" ? " kb-attention" : "")
                }
              >
                <FileText className="size-4 shrink-0" aria-hidden />
                <span className="shrink-0 font-medium">
                  {original.mime === "application/pdf" ? t.kb.openPdf : t.kb.downloadOriginal}
                </span>
                <span className="truncate text-[var(--muted-foreground)]">
                  {original.name} · {formatBytes(original.bytes, locale)}
                </span>
              </a>
            )}
            {actions}
          </div>
        </header>

        {original?.mime === "application/pdf" && (
          <p role="note" className="rounded-md border px-3 py-2 text-sm text-[var(--muted-foreground)]">
            {t.kb.pdfHint}
          </p>
        )}

        {unread.length > 0 && (
          <p role="note" className="rounded-md border px-3 py-2 text-sm">
            {t.kb.unextractedAttachments(unread.map((item) => item.name).join(", "))}
          </p>
        )}

        {article.extraction === "unextracted" ? (
          <p role="note" className="rounded-md border px-3 py-2 text-sm">
            {t.kb.unextractedBody}
          </p>
        ) : pieces ? (
          <RunbookRun total={runbook?.steps.length ?? 0}>
            {pieces.map((piece, index) =>
              piece.kind === "html" ? (
                piece.html.trim() === "" ? null : (
                  <div
                    key={index}
                    className="prose-editor kb-article min-w-0 text-sm break-words"
                    dangerouslySetInnerHTML={{ __html: piece.html }}
                  />
                )
              ) : (
                <RunbookSteps key={index} steps={piece.steps} first={piece.from} />
              ),
            )}
          </RunbookRun>
        ) : drawn ? (
          <div
            className="prose-editor kb-article min-w-0 text-sm break-words"
            dangerouslySetInnerHTML={{ __html: drawn.html }}
          />
        ) : (
          <pre className="min-w-0 font-sans text-sm break-words whitespace-pre-wrap">{article.body}</pre>
        )}
      </article>
      {drawn && drawn.outline.length > 0 && <KbOutline items={drawn.outline} />}
    </div>
  );
}
