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

/** A file size in the units a person would say it in. */
export function formatBytes(bytes: number, locale: Locale = DEFAULT_LOCALE): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value)} ${units[unit]}`;
}
