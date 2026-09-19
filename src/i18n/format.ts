import { DEFAULT_LOCALE, type Locale } from "@/i18n/locales";

/**
 * Dates and numbers are formatted against the active locale, explicitly, never
 * the server's own default (CLAUDE.md).
 */

const dateFormats = new Map<string, Intl.DateTimeFormat>();

function dateFormat(locale: Locale, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}:${JSON.stringify(options)}`;
  let formatter = dateFormats.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    dateFormats.set(key, formatter);
  }
  return formatter;
}

/** An ISO date (YYYY-MM-DD), rendered without timezone drift. */
export function formatDate(iso: string, locale: Locale = DEFAULT_LOCALE): string {
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return iso;
  return dateFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(parsed);
}

export function formatDateTime(date: Date, locale: Locale = DEFAULT_LOCALE): string {
  return dateFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function formatNumber(value: number, locale: Locale = DEFAULT_LOCALE): string {
  return new Intl.NumberFormat(locale).format(value);
}

/** "1 location" / "2 locations", with the count formatted for the locale. */
export function plural(
  count: number,
  singular: string,
  pluralForm: string,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return `${formatNumber(count, locale)} ${count === 1 ? singular : pluralForm}`;
}
