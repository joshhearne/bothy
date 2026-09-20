import "server-only";
import { cookies } from "next/headers";
import { DEFAULT_THEME, isTheme, THEME_COOKIE, type Theme } from "@/lib/theme";

/**
 * Read on the server so the palette is in the first byte of HTML. A choice
 * applied by script after paint is a flash of the wrong colors.
 */
export async function getTheme(): Promise<Theme> {
  const chosen = (await cookies()).get(THEME_COOKIE)?.value;
  return isTheme(chosen) ? chosen : DEFAULT_THEME;
}
