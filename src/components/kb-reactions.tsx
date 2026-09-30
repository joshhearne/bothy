import Link from "next/link";
import type { Route } from "next";
import { BookOpen, Star, ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ArticleSummary } from "@/server/services/kb";
import type { ArticleWithCollection, Reaction } from "@/server/services/kb-reactions";
import { formatDateTime } from "@/i18n/format";
import type { Messages } from "@/i18n";
import type { Locale } from "@/i18n/locales";

/** "12 favorites · 80% helpful · 5 votes", for the line under a title. */
export function reactionSummary(article: ArticleSummary, t: Messages): string[] {
  return [
    article.favorites > 0 ? t.kb.favoriteCount(article.favorites) : null,
    article.helpful !== null ? t.kb.helpfulScore(article.helpful, article.votes) : null,
  ].filter((part): part is string => part !== null);
}

/**
 * The reader's own buttons on an article: keep it, and say whether it
 * helped. Plain forms, so they work before any script has loaded, and each
 * submit redraws the page with the counts as they now stand.
 */
export function ReactionBar({
  article,
  reaction,
  toggleFavorite,
  vote,
  t,
}: {
  article: ArticleSummary;
  reaction: Reaction;
  toggleFavorite: (formData: FormData) => Promise<void>;
  vote: (formData: FormData) => Promise<void>;
  t: Messages;
}) {
  const voteButton = (
    value: "up" | "down",
    chosen: boolean,
    label: string,
    Icon: typeof ThumbsUp,
  ) => (
    <form action={vote}>
      <input type="hidden" name="article" value={article.id} />
      <input type="hidden" name="vote" value={chosen ? "none" : value} />
      <Button
        type="submit"
        variant={chosen ? "default" : "outline"}
        size="sm"
        aria-pressed={chosen}
        title={chosen ? t.kb.yourVote : undefined}
      >
        <Icon className="size-4" aria-hidden />
        {label}
      </Button>
    </form>
  );

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2">
      <form action={toggleFavorite}>
        <input type="hidden" name="article" value={article.id} />
        <input type="hidden" name="on" value={reaction.favorite ? "0" : "1"} />
        <Button
          type="submit"
          variant={reaction.favorite ? "default" : "outline"}
          size="sm"
          aria-pressed={reaction.favorite}
        >
          <Star className={cn("size-4", reaction.favorite && "fill-current")} aria-hidden />
          {reaction.favorite ? t.kb.unfavorite : t.kb.favorite}
        </Button>
      </form>

      <span className="text-sm text-[var(--muted-foreground)]">{t.kb.wasHelpful}</span>
      {voteButton("up", reaction.vote === true, t.kb.thumbsUp, ThumbsUp)}
      {voteButton("down", reaction.vote === false, t.kb.thumbsDown, ThumbsDown)}

      <span className="text-sm text-[var(--muted-foreground)]">
        {article.helpful !== null
          ? t.kb.helpfulScore(article.helpful, article.votes)
          : t.kb.noVotes}
      </span>
    </div>
  );
}

/** A short list of articles from across the collections, with their collection named. */
export function ArticleList({
  articles,
  base,
  locale,
  t,
}: {
  articles: ArticleWithCollection[];
  base: string;
  locale: Locale;
  t: Messages;
}) {
  return (
    <ul className="flex flex-col divide-y rounded-md border">
      {articles.map((article) => (
        <li key={article.id} className="flex gap-3 px-4 py-3">
          <BookOpen className="mt-1 size-4 shrink-0 text-[var(--muted-foreground)]" aria-hidden />
          <div className="min-w-0">
            <Link
              href={`${base}/articles/${article.id}` as Route}
              className="font-medium break-words hover:underline"
            >
              {article.title}
            </Link>
            <p className="text-sm text-[var(--muted-foreground)]">
              {[
                article.collectionName,
                article.category,
                article.dateModified
                  ? t.kb.modified(formatDateTime(article.dateModified, locale))
                  : null,
                ...reactionSummary(article, t),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
