"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/alert";
import { useMessages } from "@/i18n/client";
import type { FormState } from "@/lib/form";
import { setDefaultLocaleAction, setKbPublicAction } from "./settings-actions";
import { Select } from "@/components/ui/select";

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
        <Select
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
        </Select>
      </Field>

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? t.common.saving : t.common.save}
        </Button>
      </div>
    </form>
  );
}

const controlClass =
  "w-full rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

/** Who the public knowledge base is for, and where it lives. */
export function KbPublicForm({
  mode,
  addresses,
  url,
  accessTeam,
  accessAud,
  visitor,
}: {
  mode: "off" | "addresses" | "open";
  addresses: string;
  url: string;
  accessTeam: string;
  accessAud: string;
  /** The address this administrator is arriving from, to save them looking it up. */
  visitor: string | null;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(setKbPublicAction, {});
  const [chosen, setChosen] = useState(mode);
  const t = useMessages();

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-4">
      <FormError>{state.error}</FormError>

      <Field id="kb-public-mode" label={t.admin.settings.publicMode} error={state.fieldErrors?.mode}>
        <Select
          id="kb-public-mode"
          name="mode"
          value={chosen}
          onChange={(event) => setChosen(event.target.value as typeof chosen)}
          className={`h-10 ${controlClass}`}
        >
          <option value="off">{t.admin.settings.publicModes.off}</option>
          <option value="addresses">{t.admin.settings.publicModes.addresses}</option>
          <option value="open">{t.admin.settings.publicModes.open}</option>
        </Select>
      </Field>

      {chosen === "open" && (
        <p role="note" className="rounded-md border border-[var(--destructive)] px-3 py-2 text-sm">
          {t.admin.settings.publicOpenWarning}
        </p>
      )}

      <Field
        id="kb-public-addresses"
        label={t.admin.settings.publicAddresses}
        hint={
          t.admin.settings.publicAddressesHint +
          (visitor ? ` ${t.admin.settings.publicYourAddress(visitor)}` : "")
        }
        error={state.fieldErrors?.addresses}
      >
        <textarea
          id="kb-public-addresses"
          name="addresses"
          rows={4}
          defaultValue={addresses}
          spellCheck={false}
          className={`py-2 font-mono ${controlClass}`}
        />
      </Field>

      <Field
        id="kb-public-url"
        label={t.admin.settings.publicUrl}
        hint={t.admin.settings.publicUrlHint}
        error={state.fieldErrors?.url}
      >
        <input
          id="kb-public-url"
          name="url"
          type="url"
          defaultValue={url}
          placeholder="https://"
          className={`h-10 ${controlClass}`}
        />
      </Field>

      <fieldset className="flex flex-col gap-3 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">{t.admin.settings.publicAccess}</legend>
        <p className="text-sm text-[var(--muted-foreground)]">{t.admin.settings.publicAccessHint}</p>
        <Field
          id="kb-public-access-team"
          label={t.admin.settings.publicAccessTeam}
          hint={t.admin.settings.publicAccessTeamHint}
          error={state.fieldErrors?.accessTeam}
        >
          <input
            id="kb-public-access-team"
            name="accessTeam"
            defaultValue={accessTeam}
            autoComplete="off"
            spellCheck={false}
            className={`h-10 ${controlClass}`}
          />
        </Field>
        <Field
          id="kb-public-access-aud"
          label={t.admin.settings.publicAccessAud}
          hint={t.admin.settings.publicAccessAudHint}
          error={state.fieldErrors?.accessAud}
        >
          <input
            id="kb-public-access-aud"
            name="accessAud"
            defaultValue={accessAud}
            autoComplete="off"
            spellCheck={false}
            className={`h-10 font-mono ${controlClass}`}
          />
        </Field>
      </fieldset>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? t.common.saving : t.admin.settings.publicSave}
        </Button>
        {state.ok && (
          <span role="status" className="text-sm text-[var(--muted-foreground)]">
            {t.common.saved}
          </span>
        )}
      </div>
    </form>
  );
}
