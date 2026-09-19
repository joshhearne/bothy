import "server-only";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { messagesFor, type Messages } from "@/i18n";
import { isLocale, LOCALE_COOKIE, type Locale } from "@/i18n/locales";

/**
 * The reader's own choice wins, then the instance default from APP_LOCALE.
 * No database column: a cookie works for local and SSO accounts alike.
 */
export async function getLocale(): Promise<Locale> {
  const chosen = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(chosen) ? chosen : env.APP_LOCALE;
}

export async function getMessages(): Promise<Messages> {
  return messagesFor(await getLocale());
}

/** Locale plus catalog, for a layout that hands both to the client. */
export async function getI18n(): Promise<{ locale: Locale; messages: Messages }> {
  const locale = await getLocale();
  return { locale, messages: messagesFor(locale) };
}
