"use client";

import { VAULT_KINDS } from "@/server/vault/types";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/alert";
import type { FormState } from "@/lib/form";
import { useMessages } from "@/i18n/client";
import { mapCollectionAction, saveVaultProviderAction } from "./vault-actions";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  const t = useMessages();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? t.common.saving : label}
    </Button>
  );
}

const selectClass =
  "h-10 w-full rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

export function VaultProviderForm({
  provider,
}: {
  provider?: {
    id: string;
    name: string;
    kind: string;
    webVaultUrl: string | null;
    organizationId: string | null;
    allowCreate: boolean;
    enabled: boolean;
  };
}) {
  const [state, formAction] = useActionState<FormState, FormData>(saveVaultProviderAction, {});
  const fieldErrors = state.fieldErrors ?? {};
  const t = useMessages();

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-4">
      <FormError>{state.error}</FormError>
      {state.ok && <p className="text-sm text-[var(--muted-foreground)]">{t.common.saved}</p>}
      {provider && <input type="hidden" name="id" value={provider.id} />}

      <Field id="name" label={t.common.name} error={fieldErrors.name}>
        <Input
          id="name"
          name="name"
          defaultValue={provider?.name ?? ""}
          required
          maxLength={200}
          placeholder="Main Vaultwarden"
        />
      </Field>

      <Field
        id="kind"
        label={t.admin.vault.mode}
        error={fieldErrors.kind}
        hint={t.admin.vault.modeHint}
      >
        <select id="kind" name="kind" defaultValue={provider?.kind ?? "link"} className={selectClass}>
          {VAULT_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {kind}
            </option>
          ))}
        </select>
      </Field>

      <Field id="webVaultUrl" label={t.admin.vault.webVaultUrl} error={fieldErrors.webVaultUrl}>
        <Input
          id="webVaultUrl"
          name="webVaultUrl"
          type="url"
          defaultValue={provider?.webVaultUrl ?? ""}
          placeholder="https://vault.example.com"
        />
      </Field>

      <Field id="organizationId" label={t.admin.vault.organizationId} error={fieldErrors.organizationId}>
        <Input
          id="organizationId"
          name="organizationId"
          defaultValue={provider?.organizationId ?? ""}
          maxLength={200}
        />
      </Field>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="allowCreate"
          defaultChecked={provider?.allowCreate ?? false}
          className="size-4 rounded border"
        />
        {t.admin.vault.allowCreate}
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={provider?.enabled ?? true}
          className="size-4 rounded border"
        />
        {t.admin.vault.enabled}
      </label>

      <div>
        <Submit
          label={provider ? t.admin.vault.saveProvider : t.admin.vault.addProviderSubmit}
        />
      </div>
    </form>
  );
}

export function MapCollectionForm({
  companies,
  providers,
}: {
  companies: { id: string; name: string }[];
  providers: { id: string; name: string }[];
}) {
  const [state, formAction] = useActionState<FormState, FormData>(mapCollectionAction, {});
  const t = useMessages();

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 rounded-md border border-dashed p-4 sm:flex-row sm:items-end"
    >
      <FormError>{state.error}</FormError>

      <div className="flex-1">
        <Field id="companyId" label={t.search.company}>
          <select id="companyId" name="companyId" className={selectClass} required>
            <option value="">{t.search.anyCompany}</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="flex-1">
        <Field id="providerId" label={t.admin.vault.provider}>
          <select id="providerId" name="providerId" className={selectClass} required>
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="flex-1">
        <Field id="collectionId" label={t.admin.vault.collectionId}>
          <Input id="collectionId" name="collectionId" required maxLength={200} />
        </Field>
      </div>

      <Submit label={t.admin.vault.mapCollection} />
    </form>
  );
}
