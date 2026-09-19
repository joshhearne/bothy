"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/alert";
import type { FormState } from "@/lib/form";
import { mapCollectionAction, saveVaultProviderAction } from "./vault-actions";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : label}
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

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-4">
      <FormError>{state.error}</FormError>
      {state.ok && <p className="text-sm text-[var(--muted-foreground)]">Saved.</p>}
      {provider && <input type="hidden" name="id" value={provider.id} />}

      <Field id="name" label="Name" error={fieldErrors.name}>
        <Input
          id="name"
          name="name"
          defaultValue={provider?.name ?? ""}
          required
          maxLength={200}
          placeholder="HearneTech Vaultwarden"
        />
      </Field>

      <Field
        id="kind"
        label="Mode"
        error={fieldErrors.kind}
        hint="link stores a deep link only. bw_serve brokers search, reveal, and TOTP through the sidecar."
      >
        <select id="kind" name="kind" defaultValue={provider?.kind ?? "link"} className={selectClass}>
          <option value="link">link</option>
          <option value="bw_serve">bw_serve</option>
        </select>
      </Field>

      <Field id="webVaultUrl" label="Web vault URL" error={fieldErrors.webVaultUrl}>
        <Input
          id="webVaultUrl"
          name="webVaultUrl"
          type="url"
          defaultValue={provider?.webVaultUrl ?? ""}
          placeholder="https://vault.example.com"
        />
      </Field>

      <Field id="organizationId" label="Organization id" error={fieldErrors.organizationId}>
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
        Allow creating vault items from a document
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={provider?.enabled ?? true}
          className="size-4 rounded border"
        />
        Enabled
      </label>

      <div>
        <Submit label={provider ? "Save provider" : "Add provider"} />
      </div>
    </form>
  );
}

export function MapCollectionForm({ companies }: { companies: { id: string; name: string }[] }) {
  const [state, formAction] = useActionState<FormState, FormData>(mapCollectionAction, {});

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 rounded-md border border-dashed p-4 sm:flex-row sm:items-end"
    >
      <FormError>{state.error}</FormError>

      <div className="flex-1">
        <Field id="companyId" label="Company">
          <select id="companyId" name="companyId" className={selectClass} required>
            <option value="">Choose a company…</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="flex-1">
        <Field id="collectionId" label="Bitwarden collection id">
          <Input id="collectionId" name="collectionId" required maxLength={200} />
        </Field>
      </div>

      <Submit label="Map collection" />
    </form>
  );
}
