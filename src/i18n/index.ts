import { enUS, type Messages } from "@/i18n/en-US";
import { enGB } from "@/i18n/en-GB";
import { mergeMessages } from "@/i18n/merge";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/locales";

const CATALOGS: Record<Locale, Messages> = {
  "en-US": enUS,
  "en-GB": mergeMessages(enUS, enGB),
};

export function messagesFor(locale: Locale): Messages {
  return CATALOGS[locale] ?? CATALOGS[DEFAULT_LOCALE];
}

export type { Messages };
export { DEFAULT_LOCALE };
