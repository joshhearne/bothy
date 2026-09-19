"use client";

import { useRef } from "react";
import { Languages } from "lucide-react";
import { LOCALE_NAMES, LOCALES, type Locale } from "@/i18n/locales";
import { useMessages } from "@/i18n/client";
import { setLocaleAction } from "@/app/locale-actions";

/** Language picker. Submits on change, so there is no extra button to press. */
export function LocaleSwitcher({ locale }: { locale: Locale }) {
  const formRef = useRef<HTMLFormElement>(null);
  const messages = useMessages();

  return (
    <form ref={formRef} action={setLocaleAction} className="flex items-center gap-1">
      <Languages className="size-4 text-[var(--muted-foreground)]" aria-hidden />
      <label htmlFor="locale" className="sr-only">
        {messages.app.language}
      </label>
      <select
        id="locale"
        name="locale"
        defaultValue={locale}
        onChange={() => formRef.current?.requestSubmit()}
        className="h-8 rounded-md border bg-transparent px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
      >
        {LOCALES.map((option) => (
          <option key={option} value={option}>
            {LOCALE_NAMES[option]}
          </option>
        ))}
      </select>
    </form>
  );
}
