"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/alert";
import { useMessages } from "@/i18n/client";
import type { FormState } from "@/lib/form";
import { setDefaultLocaleAction } from "./settings-actions";

/** The language a reader who has never chosen one gets. */
export function DefaultLocaleForm({
  chosen,
  fallback,
  locales,
}: {
  chosen: string | null;
  fallback: string;
  locales: { value: string; label: string }[];
}) {
  const [state, formAction] = useActionState<FormState, FormData>(setDefaultLocaleAction, {});
  const { pending } = useFormStatus();
  const t = useMessages();

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-3">
      <FormError>{state.error}</FormError>

      <Field
        id="defaultLocale"
        label={t.admin.settings.defaultLanguage}
        hint={t.admin.settings.defaultLanguageHint(fallback)}
      >
        <select
          id="defaultLocale"
          name="defaultLocale"
          defaultValue={chosen ?? ""}
          className="h-10 w-full rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          <option value="">{t.admin.settings.fromEnvironment(fallback)}</option>
          {locales.map((locale) => (
            <option key={locale.value} value={locale.value}>
              {locale.label}
            </option>
          ))}
        </select>
      </Field>

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? t.common.saving : t.common.save}
        </Button>
      </div>
    </form>
  );
}
