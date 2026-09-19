"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { isLocale, LOCALE_COOKIE } from "@/i18n/locales";

/** Remembers a reader's language choice for a year. */
export async function setLocaleAction(formData: FormData): Promise<void> {
  const choice = formData.get("locale");
  if (!isLocale(choice)) return;

  (await cookies()).set(LOCALE_COOKIE, choice, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    httpOnly: false,
  });

  revalidatePath("/", "layout");
}
