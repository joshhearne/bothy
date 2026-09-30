"use server";

import { revalidatePath } from "next/cache";
import { text } from "@/lib/form";
import { publicIdentity } from "@/server/kb/identity";
import { requirePublicReader } from "@/server/kb/public";
import { NotFoundError } from "@/server/services/errors";
import { setFavorite, setVote } from "@/server/services/kb-reactions";

/**
 * What a public reader may do: keep an article, and say whether it helped.
 * Both need the reader to be somebody, which Cloudflare Access says; a
 * request without that is simply nothing done.
 */

const UUID = /^[0-9a-f-]{36}$/i;

async function who(articleId: string | undefined) {
  if (!articleId || !UUID.test(articleId)) return null;
  const reader = await requirePublicReader();
  const identity = await publicIdentity();
  return identity ? { reader, identity } : null;
}

function refresh(articleId: string): void {
  revalidatePath(`/pub/kb/articles/${articleId}`);
  revalidatePath("/pub/kb");
}

export async function toggleFavoriteAction(formData: FormData): Promise<void> {
  const articleId = text(formData, "article");
  const caller = await who(articleId);
  if (!caller || !articleId) return;

  try {
    await setFavorite(caller.identity.key, articleId, formData.get("on") === "1", caller.reader);
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
  }
  refresh(articleId);
}

export async function voteAction(formData: FormData): Promise<void> {
  const articleId = text(formData, "article");
  const caller = await who(articleId);
  if (!caller || !articleId) return;

  const vote = text(formData, "vote");
  const helpful = vote === "up" ? true : vote === "down" ? false : null;
  try {
    await setVote(caller.identity.key, articleId, helpful, caller.reader);
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
  }
  refresh(articleId);
}
