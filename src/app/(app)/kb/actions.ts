"use server";

import { revalidatePath } from "next/cache";
import { checkbox, text } from "@/lib/form";
import { getCompanyScope, requireAdmin, requireUser } from "@/server/auth/session";
import { readerKey } from "@/server/kb/identity";
import { NotFoundError } from "@/server/services/errors";
import { setArticlePublicHidden } from "@/server/services/kb";
import { setFavorite, setVote } from "@/server/services/kb-reactions";

const UUID = /^[0-9a-f-]{36}$/i;

/** A signed-in reader keeping or rating an article, as the public site lets them. */
async function reacting(articleId: string | undefined) {
  if (!articleId || !UUID.test(articleId)) return null;
  const user = await requireUser();
  return { key: readerKey(user.email), reader: { scope: await getCompanyScope(user), via: "app" as const } };
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
