"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { isTheme, THEME_COOKIE } from "@/lib/theme";

/** Remembers a reader's color scheme choice for a year. */
export async function setThemeAction(formData: FormData): Promise<void> {
  const choice = formData.get("theme");
  if (!isTheme(choice)) return;

  (await cookies()).set(THEME_COOKIE, choice, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    httpOnly: false,
  });

  revalidatePath("/", "layout");
}
