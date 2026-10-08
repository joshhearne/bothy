"use server";

import { revalidatePath } from "next/cache";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { checkbox, text, toFieldErrors, type FormState } from "@/lib/form";
import { getCompanyScope, hasRecentMfa, requireAdmin, requireRecentMfa, requireUser } from "@/server/auth/session";
import { readerKey } from "@/server/kb/identity";
import { RunbookStepError } from "@/server/kb/runbook";
import { ForbiddenError, NotFoundError } from "@/server/services/errors";
import { grantsForUser } from "@/server/services/kb-grants";
import { moveArticle, writeArticle } from "@/server/services/kb-write";
import { listCategories } from "@/server/services/kb";
import { setArticlePublicHidden } from "@/server/services/kb";
import { setFavorite, setVote } from "@/server/services/kb-reactions";
import { can, isAdministrator } from "@/server/auth/roles";

const UUID = /^[0-9a-f-]{36}$/i;

/** A signed-in reader keeping or rating an article, as the public site lets them. */
async function reacting(articleId: string | undefined) {
  if (!articleId || !UUID.test(articleId)) return null;
  const user = await requireUser();
  return { key: readerKey(user.email), reader: { scope: await getCompanyScope(user), via: "app" as const, userId: user.id } };
}

function refresh(articleId: string): void {
  revalidatePath(`/kb/articles/${articleId}`);
  revalidatePath("/kb");
}

export async function toggleFavoriteAction(formData: FormData): Promise<void> {
  const articleId = text(formData, "article");
  const caller = await reacting(articleId);
  if (!caller || !articleId) return;
  try {
    await setFavorite(caller.key, articleId, formData.get("on") === "1", caller.reader);
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
  }
  refresh(articleId);
}

export async function voteAction(formData: FormData): Promise<void> {
  const articleId = text(formData, "article");
  const caller = await reacting(articleId);
  if (!caller || !articleId) return;
  const vote = text(formData, "vote");
  try {
    await setVote(caller.key, articleId, vote === "up" ? true : vote === "down" ? false : null, caller.reader);
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
  }
  refresh(articleId);
}

export async function setArticlePublicHiddenAction(formData: FormData): Promise<void> {
  const id = text(formData, "id");
  if (!id) return;

  const user = await requireAdmin();
  await setArticlePublicHidden(id, checkbox(formData, "hidden"), user.id);
  revalidatePath(`/kb/articles/${id}`);
}

/* ---------- Writing an article in the app ---------- */

/** The signed-in person as a writer: an administrator may write anywhere; anyone else where granted. */
async function writerFor() {
  const user = await requireUser();
  return {
    via: "app" as const,
    scope: await getCompanyScope(user),
    grants: await grantsForUser(user.id),
    userId: user.id,
    userName: user.name,
    admin: can(user.role, "kb.write"),
  };
}

/** `kind-of-thing-3f9a`: a name for an article written here, stable for its life. */
function mintExternalId(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const bytes = new Uint8Array(2);
  crypto.getRandomValues(bytes);
  const tail = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${slug || "article"}-${tail}`;
}

/** The categories and sections a collection already has, for the editor's dropdowns. */
export async function collectionCategoriesAction(
  collectionId: string,
): Promise<{ category: string | null; subcategory: string | null }[]> {
  if (!/^[0-9a-f-]{36}$/i.test(collectionId)) return [];
  const user = await requireUser();
  const rows = await listCategories(collectionId, { scope: await getCompanyScope(user), via: "app", userId: user.id });
  return rows.map((row) => ({ category: row.category, subcategory: row.subcategory }));
}

/**
 * Moving an article is an administrator's step with the second factor fresh:
 * this asks for it when it is not, and comes back to the editor unlocked.
 */
export async function unlockMoveAction(formData: FormData): Promise<void> {
  const articleId = text(formData, "articleId") ?? "";
  if (!UUID.test(articleId)) return;
  const user = await requireAdmin();
  const back = `/kb/articles/${articleId}/edit?unlock=move`;
  await requireRecentMfa(user, back);
  redirect(back as Route);
}

export async function saveArticleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const collectionId = text(formData, "collectionId") ?? "";
  const fromCollectionId = text(formData, "fromCollectionId");
  const articleIdGiven = text(formData, "articleId");
  const existingId = text(formData, "externalId");
  const title = text(formData, "title") ?? "";
  let articleId: string;
  try {
    const writer = await writerFor();
    // A change of collection is a move, which only an administrator with a fresh second step may make.
    if (articleIdGiven && fromCollectionId && fromCollectionId !== collectionId) {
      const user = await requireUser();
      if (!isAdministrator(user.role) || !hasRecentMfa(user)) return { error: "Unlock moving with your second step first" };
      await moveArticle(articleIdGiven, collectionId, writer);
    }
    const result = await writeArticle(
      {
        collectionId,
        externalId: existingId ?? mintExternalId(title),
        title,
        body: (formData.get("body") as string | null) ?? "",
        category: text(formData, "category"),
        subcategory: text(formData, "subcategory"),
        kind: checkbox(formData, "runbook") ? "runbook" : "article",
        publicHidden: checkbox(formData, "internalOnly"),
      },
      writer,
    );
    articleId = result.articleId;
  } catch (err) {
    if (err instanceof ZodError) return { fieldErrors: toFieldErrors(err) };
    if (err instanceof RunbookStepError) return { fieldErrors: { body: err.message } };
    if (err instanceof NotFoundError || err instanceof ForbiddenError) return { error: err.message };
    throw err;
  }
  revalidatePath(`/kb/${collectionId}`);
  if (fromCollectionId) revalidatePath(`/kb/${fromCollectionId}`);
  revalidatePath(`/kb/articles/${articleId}`);
  redirect(`/kb/articles/${articleId}`);
}
