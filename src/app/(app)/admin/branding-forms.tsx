"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/alert";
import { useMessages } from "@/i18n/client";
import type { FormState } from "@/lib/form";
import { saveBrandingAction, saveCompanyBrandingAction, uploadLogoAction } from "./branding-actions";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  const t = useMessages();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? t.common.saving : label}
    </Button>
  );
}

/**
 * A color is typed or picked, and the two inputs stay in step: the picker is
 * the easy way in, the text field is how somebody pastes the hex from a brand
 * guide. Empty means "no accent", which is what clears it.
 */
function AccentField({
  defaultValue,
  error,
}: {
  defaultValue: string | null;
  error?: string | undefined;
}) {
  const t = useMessages();
  const [value, setValue] = useState(defaultValue ?? "");

  return (
    <Field id="accent" label={t.admin.branding.accent} error={error} hint={t.admin.branding.accentHint}>
      <div className="flex items-center gap-2">
        <Input
          id="accent"
          name="accent"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="#1f6feb"
          maxLength={7}
          className="font-mono"
        />
        <input
          type="color"
          aria-label={t.admin.branding.accent}
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#1f6feb"}
          onChange={(event) => setValue(event.target.value)}
          className="size-9 shrink-0 cursor-pointer rounded-md border bg-transparent"
        />
        {value !== "" && (
          <Button type="button" variant="outline" size="sm" onClick={() => setValue("")}>
            {t.common.clear}
          </Button>
        )}
      </div>
    </Field>
  );
}

export function InstanceBrandingForm({
  name,
  accent,
}: {
  name: string | null;
  accent: string | null;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(saveBrandingAction, {});
  const fieldErrors = state.fieldErrors ?? {};
  const t = useMessages();

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-4">
      <FormError>{state.error}</FormError>

      <Field
        id="name"
        label={t.admin.branding.portalName}
        error={fieldErrors.name}
        hint={t.admin.branding.portalNameHint}
      >
        <Input id="name" name="name" defaultValue={name ?? ""} maxLength={60} placeholder="Bothy" />
      </Field>

      <AccentField defaultValue={accent} error={fieldErrors.accent} />

      <div>
        <Submit label={t.admin.branding.save} />
      </div>
    </form>
  );
}

export function LogoForm({ accept, hasLogo }: { accept: string; hasLogo: boolean }) {
  const [state, formAction] = useActionState<FormState, FormData>(uploadLogoAction, {});
  const t = useMessages();

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-3">
      <FormError>{state.error}</FormError>

      <Field id="logo" label={t.admin.branding.logo} error={state.fieldErrors?.logo} hint={t.admin.branding.logoHint}>
        <input
          id="logo"
          name="logo"
          type="file"
          accept={accept}
          required
          className="block w-full text-sm file:mr-3 file:rounded-md file:border file:bg-transparent file:px-3 file:py-1.5 file:text-sm"
        />
      </Field>

      <div>
        <Submit label={hasLogo ? t.admin.branding.replace : t.admin.branding.upload} />
      </div>
    </form>
  );
}

/** The same two controls, saved together, for one company. */
export function CompanyBrandingForm({
  companyId,
  accent,
  accept,
  hasLogo,
}: {
  companyId: string;
  accent: string | null;
  accept: string;
  hasLogo: boolean;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(saveCompanyBrandingAction, {});
  const t = useMessages();

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-4">
      <input type="hidden" name="companyId" value={companyId} />
      <FormError>{state.error}</FormError>

      <AccentField defaultValue={accent} error={state.fieldErrors?.accent} />

      <Field id="logo" label={t.admin.branding.logo} error={state.fieldErrors?.logo} hint={t.admin.branding.logoHint}>
        <input
          id="logo"
          name="logo"
          type="file"
          accept={accept}
          className="block w-full text-sm file:mr-3 file:rounded-md file:border file:bg-transparent file:px-3 file:py-1.5 file:text-sm"
        />
      </Field>

      <div>
        <Submit label={hasLogo ? t.admin.branding.replace : t.admin.branding.save} />
      </div>
    </form>
  );
}
