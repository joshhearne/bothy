"use client";

import { createContext, useContext, useMemo } from "react";
import type { Messages } from "@/i18n/en-US";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/locales";
import { messagesFor } from "@/i18n";

/**
 * Only the locale crosses the server boundary. The catalogs hold interpolation
 * functions, which cannot be serialized into a client component, so the client
 * imports them directly and looks up the one it needs.
 */
const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

/** The catalog for the current reader, inside a client component. */
export function useMessages(): Messages {
  const locale = useLocale();
  return useMemo(() => messagesFor(locale), [locale]);
}
