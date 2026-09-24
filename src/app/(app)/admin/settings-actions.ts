"use server";

import { revalidatePath } from "next/cache";
import { text, type FormState } from "@/lib/form";
import { ForbiddenError, requireAdmin } from "@/server/auth/session";
import { setDefaultLocale } from "@/server/services/settings";

export async function setDefaultLocaleAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await requireAdmin();
    await setDefaultLocale(text(formData, "defaultLocale") ?? null, user.id);
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    throw err;
  }

  // The language reaches every page, so the whole tree is revalidated.
  revalidatePath("/", "layout");
  return { ok: true };
}
