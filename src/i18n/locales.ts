/**
 * Supported locales. en-US is the base: every other locale is expressed as a
 * set of overrides on top of it, so a translation can never go missing a key.
 */
export const LOCALES = ["en-US", "en-GB"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en-US";

export const LOCALE_NAMES: Record<Locale, string> = {
  "en-US": "English (United States)",
  "en-GB": "English (United Kingdom)",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** The cookie a reader's own choice is remembered in. */
export const LOCALE_COOKIE = "bothy-locale";
