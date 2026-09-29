"use server";

import { revalidatePath } from "next/cache";
import { checkbox, text } from "@/lib/form";
import { requireAdmin } from "@/server/auth/session";
import { setArticlePublicHidden } from "@/server/services/kb";

export async function setArticlePublicHiddenAction(formData: FormData): Promise<void> {
  const id = text(formData, "id");
  if (!id) return;

  const user = await requireAdmin();
  await setArticlePublicHidden(id, checkbox(formData, "hidden"), user.id);
  revalidatePath(`/kb/articles/${id}`);
}
