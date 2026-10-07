"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/alert";
import { useMessages } from "@/i18n/client";
import type { FormState } from "@/lib/form";
import type { BrandScheme } from "@/server/services/branding";
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
 * guide. Empty means "no color", which is what clears it.
 */
function AccentField({
  name,
  label,
  hint,
  defaultValue,
  error,
  placeholder = "#1f6feb",
  clearLabel,
}: {
  name: string;
  label: string;
  hint: string;
  defaultValue: string | null;
  error?: string | undefined;
  placeholder?: string;
  /** What emptying the field means, when it is not simply "no color": "Auto", say. */
  clearLabel?: string;
}) {
  const t = useMessages();
  const [value, setValue] = useState(defaultValue ?? "");

  return (
    <Field id={name} label={label} error={error} hint={hint}>
      <div className="flex items-center gap-2">
        <Input
          id={name}
          name={name}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={placeholder}
          maxLength={7}
          className="font-mono"
        />
        <input
          type="color"
          aria-label={label}
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : placeholder}
          onChange={(event) => setValue(event.target.value)}
          className="size-9 shrink-0 cursor-pointer rounded-md border bg-transparent"
        />
        {(value !== "" || clearLabel) && (
          <Button type="button" variant="outline" size="sm" disabled={value === ""} onClick={() => setValue("")}>
            {clearLabel ?? t.common.clear}
          </Button>
        )}
      </div>
    </Field>
  );
}

/**
 * Which mode the brand was drawn for. Choosing it renames the fields either
 * side, so it is always clear which colour and logo belong to which theme.
 */
function SchemeChoice({
  scheme,
  onChange,
}: {
  scheme: BrandScheme;
  onChange: (next: BrandScheme) => void;
}) {
  const t = useMessages();

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">{t.admin.branding.scheme}</legend>
      <div className="flex flex-wrap gap-4">
        {(["light", "dark"] as const).map((option) => (
          <label key={option} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="scheme"
              value={option}
              defaultChecked={scheme === option}
              onChange={() => onChange(option)}
              className="size-4"
            />
            {option === "light" ? t.admin.branding.lightMode : t.admin.branding.darkMode}
          </label>
        ))}
      </div>
      <p className="text-xs text-[var(--muted-foreground)]">{t.admin.branding.schemeHint}</p>
    </fieldset>
  );
}

export function InstanceBrandingForm({
  name,
  accent,
  altAccent,
  accentText,
  altAccentText,
  showPoweredBy,
  iconFollowsMode,
  previews,
  logos,
}: {
  name: string | null;
  /** Light mode. */
  accent: string | null;
  /** Dark mode. */
  altAccent: string | null;
  accentText: string | null;
  altAccentText: string | null;
  showPoweredBy: boolean;
  iconFollowsMode: boolean;
  /** The two theme previews, light then dark, drawn by the page. */
  previews: [React.ReactNode, React.ReactNode];
  /** The two logo panels, light then dark, drawn by the page. */
  logos: [React.ReactNode, React.ReactNode];
}) {
  const [state, formAction] = useActionState<FormState, FormData>(saveBrandingAction, {});
  const fieldErrors = state.fieldErrors ?? {};
  const t = useMessages();
  const light = t.admin.branding.lightMode.toLowerCase();
  const dark = t.admin.branding.darkMode.toLowerCase();

  const formId = "instance-branding";

  return (
    <div className="flex flex-col gap-6">
      <form id={formId} action={formAction} className="flex flex-col gap-6">
        <FormError>{state.error}</FormError>

        <Field
          id="name"
          label={t.admin.branding.portalName}
          error={fieldErrors.name}
          hint={t.admin.branding.portalNameHint}
        >
          <Input
            id="name"
            name="name"
            defaultValue={name ?? ""}
            maxLength={60}
            placeholder="Trove KB"
            className="max-w-xl"
          />
        </Field>

        <p className="text-sm text-[var(--muted-foreground)]">{t.admin.branding.colorsHint}</p>

        {/* Light on the left, dark on the right; one under the other on a phone. */}
        <div className="grid gap-6 sm:grid-cols-2">
          <section aria-label={t.admin.branding.lightSection} className="flex flex-col gap-4">
            {previews[0]}
            <AccentField
              name="accent"
              label={t.admin.branding.accentFor(light)}
              hint={t.admin.branding.accentHint}
              defaultValue={accent}
              error={fieldErrors.accent}
            />
            <AccentField
              name="accentText"
              label={t.admin.branding.accentTextFor(light)}
              hint={t.admin.branding.accentTextHint}
              defaultValue={accentText}
              error={fieldErrors.accentText}
              placeholder="#ffffff"
              clearLabel={t.admin.branding.auto}
            />
          </section>

          <section aria-label={t.admin.branding.darkSection} className="flex flex-col gap-4">
            {previews[1]}
            <AccentField
              name="altAccent"
              label={t.admin.branding.accentFor(dark)}
              hint={t.admin.branding.altAccentHint(dark)}
              defaultValue={altAccent}
              error={fieldErrors.altAccent}
            />
            <AccentField
              name="altAccentText"
              label={t.admin.branding.accentTextFor(dark)}
              hint={t.admin.branding.accentTextHint}
              defaultValue={altAccentText}
              error={fieldErrors.altAccentText}
              placeholder="#ffffff"
              clearLabel={t.admin.branding.auto}
            />
          </section>
        </div>
      </form>

      {/* Logos upload on their own, one per mode, under the colors for that mode. */}
      <div className="grid gap-6 sm:grid-cols-2">
        {logos[0]}
        {logos[1]}
      </div>

      {/* Part of the form above, drawn after the logos: the page reads top to bottom. */}
      <div className="flex flex-col gap-4 border-t pt-6">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="showPoweredBy"
            form={formId}
            defaultChecked={showPoweredBy}
            className="mt-0.5 size-4 rounded border"
          />
          <span>
            <span className="font-medium">{t.admin.branding.poweredBy}</span>
            <span className="block text-xs text-[var(--muted-foreground)]">
              {t.admin.branding.poweredByHint}
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="iconFollowsMode"
            form={formId}
            defaultChecked={iconFollowsMode}
            className="mt-0.5 size-4 rounded border"
          />
          <span>
            <span className="font-medium">{t.admin.branding.iconFollowsMode}</span>
            <span className="block text-xs text-[var(--muted-foreground)]">
              {t.admin.branding.iconFollowsModeHint}
            </span>
          </span>
        </label>
        <div>
          <Button type="submit" form={formId}>
            {t.admin.branding.save}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** One logo slot. The label says which theme it is for, so neither is a guess. */
export function LogoForm({
  accept,
  hasLogo,
  slot,
  label,
  hint,
}: {
  accept: string;
  hasLogo: boolean;
  slot: "primary" | "alt";
  label: string;
  hint: string;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(uploadLogoAction, {});
  const t = useMessages();
  const id = `logo-${slot}`;

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-3">
      <FormError>{state.error}</FormError>
      <input type="hidden" name="slot" value={slot} />

      <Field id={id} label={label} error={state.fieldErrors?.logo} hint={hint}>
        <input
          id={id}
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

/** The same controls for one company, saved together. */
export function CompanyBrandingForm({
  companyId,
  scheme,
  accent,
  altAccent,
  accept,
  hasLogo,
}: {
  companyId: string;
  scheme: BrandScheme;
  accent: string | null;
  altAccent: string | null;
  accept: string;
  hasLogo: boolean;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(saveCompanyBrandingAction, {});
  const [chosen, setChosen] = useState<BrandScheme>(scheme);
  const t = useMessages();

  const modeName = (value: BrandScheme) =>
    value === "light" ? t.admin.branding.lightMode : t.admin.branding.darkMode;
  const other: BrandScheme = chosen === "light" ? "dark" : "light";

  const fileClass =
    "block w-full text-sm file:mr-3 file:rounded-md file:border file:bg-transparent file:px-3 file:py-1.5 file:text-sm";

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-4">
      <input type="hidden" name="companyId" value={companyId} />
      <FormError>{state.error}</FormError>

      <SchemeChoice scheme={scheme} onChange={setChosen} />

      <AccentField
        name="accent"
        label={t.admin.branding.accentFor(modeName(chosen).toLowerCase())}
        hint={t.admin.branding.accentHint}
        defaultValue={accent}
        error={state.fieldErrors?.accent}
      />
      <AccentField
        name="altAccent"
        label={t.admin.branding.accentFor(modeName(other).toLowerCase())}
        hint={t.admin.branding.altAccentHint(modeName(other).toLowerCase())}
        defaultValue={altAccent}
        error={state.fieldErrors?.altAccent}
      />

      <Field
        id="company-logo"
        label={t.admin.branding.logoFor(modeName(chosen).toLowerCase())}
        error={state.fieldErrors?.logo}
        hint={t.admin.branding.logoHint}
      >
        <input id="company-logo" name="logo" type="file" accept={accept} className={fileClass} />
      </Field>

      <Field
        id="company-alt-logo"
        label={t.admin.branding.logoFor(modeName(other).toLowerCase())}
        hint={t.admin.branding.altLogoHint(modeName(other).toLowerCase())}
      >
        <input id="company-alt-logo" name="altLogo" type="file" accept={accept} className={fileClass} />
      </Field>

      <div>
        <Submit label={hasLogo ? t.admin.branding.replace : t.admin.branding.save} />
      </div>
    </form>
  );
}
