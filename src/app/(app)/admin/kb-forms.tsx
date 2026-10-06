"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { FormError } from "@/components/ui/alert";
import { useMessages } from "@/i18n/client";
import type { FormState } from "@/lib/form";
import {
  createCollectionAction,
  createConnectorAction,
  updateCollectionAction,
} from "./kb-actions";
import { Select } from "@/components/ui/select";

const selectClass =
  "h-10 w-full rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

function Toggle({
  name,
  label,
  hint,
  defaultChecked,
}: {
  name: string;
  label: string;
  hint: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex items-start gap-3 text-sm">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="mt-0.5 size-4 accent-[var(--primary)]"
      />
      <span>
        <span className="block font-medium">{label}</span>
        <span className="block text-xs text-[var(--muted-foreground)]">{hint}</span>
      </span>
    </label>
  );
}

export type CollectionValues = {
  id: string;
  name: string;
  description: string | null;
  siteUrl: string | null;
  mcpEnabled: boolean;
  publicAccess: boolean;
  companyIds: string[];
};

export type CompanyChoice = { id: string; name: string };

/** Creates a collection, or edits one when it is handed one. */
export function CollectionForm({
  collection,
  companies,
  publicSiteOn,
}: {
  collection?: CollectionValues;
  companies: CompanyChoice[];
  /** Whether the public site is turned on at all. */
  publicSiteOn: boolean;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    collection ? updateCollectionAction : createCollectionAction,
    {},
  );
  const t = useMessages();
  const [chosen, setChosen] = useState<Set<string>>(new Set(collection?.companyIds ?? []));

  function toggle(id: string, on: boolean) {
    setChosen((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-4">
      <FormError>{state.error}</FormError>
      {collection && <input type="hidden" name="id" value={collection.id} />}

      <Field
        id="kb-name"
        label={t.admin.kb.name}
        hint={t.admin.kb.nameHint}
        error={state.fieldErrors?.name}
      >
        <Input id="kb-name" name="name" required maxLength={120} defaultValue={collection?.name} />
      </Field>

      <Field
        id="kb-description"
        label={t.admin.kb.description}
        hint={t.admin.kb.descriptionHint}
        error={state.fieldErrors?.description}
      >
        <Input
          id="kb-description"
          name="description"
          maxLength={500}
          defaultValue={collection?.description ?? ""}
        />
      </Field>

      <Field
        id="kb-site-url"
        label={t.admin.kb.siteUrl}
        hint={t.admin.kb.siteUrlHint}
        error={state.fieldErrors?.siteUrl}
      >
        <Input
          id="kb-site-url"
          name="siteUrl"
          type="url"
          maxLength={2000}
          placeholder="https://"
          defaultValue={collection?.siteUrl ?? ""}
        />
      </Field>

      <Toggle
        name="mcpEnabled"
        label={t.admin.kb.mcpEnabled}
        hint={t.admin.kb.mcpEnabledHint}
        defaultChecked={collection?.mcpEnabled ?? true}
      />

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">{t.admin.kb.companies}</legend>
        <p className="text-xs text-[var(--muted-foreground)]">{t.admin.kb.companiesHint}</p>

        {companies.length === 0 ? (
          <p className="text-xs text-[var(--muted-foreground)]">{t.access.none}</p>
        ) : (
          <div className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-md border p-2">
            {companies.map((company) => (
              <label key={company.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="companyIds"
                  value={company.id}
                  checked={chosen.has(company.id)}
                  onChange={(event) => toggle(company.id, event.target.checked)}
                  className="size-4 rounded border accent-[var(--primary)]"
                />
                <span className="min-w-0 break-words">{company.name}</span>
              </label>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <p role="status" className="text-xs font-medium">
            {chosen.size === 0 ? t.admin.kb.companiesAll : t.admin.kb.companiesOnly(chosen.size)}
          </p>
          {chosen.size > 0 && (
            <button
              type="button"
              onClick={() => setChosen(new Set())}
              className="text-xs underline"
            >
              {t.admin.kb.companiesClear}
            </button>
          )}
        </div>
      </fieldset>

      <Toggle
        name="publicAccess"
        label={t.admin.kb.publicAccess}
        hint={publicSiteOn ? t.admin.kb.publicAccessHint : t.admin.kb.publicAccessOff}
        defaultChecked={collection?.publicAccess ?? false}
      />

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? t.common.saving : collection ? t.admin.kb.save : t.admin.kb.create}
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

export function ConnectorForm({ collectionId }: { collectionId: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createConnectorAction,
    {},
  );
  const [kind, setKind] = useState<"sitemap" | "prefix" | "helpcenter">("sitemap");
  const t = useMessages();

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-4">
      <FormError>{state.error}</FormError>
      <input type="hidden" name="collectionId" value={collectionId} />

      <Field id="connector-kind" label={t.admin.kb.kind}>
        <Select
          id="connector-kind"
          name="kind"
          value={kind}
          onChange={(event) =>
            setKind(
              event.target.value === "prefix"
                ? "prefix"
                : event.target.value === "helpcenter"
                  ? "helpcenter"
                  : "sitemap",
            )
          }
          className={selectClass}
        >
          <option value="sitemap">{t.admin.kb.kindSitemap}</option>
          <option value="prefix">{t.admin.kb.kindPrefix}</option>
          <option value="helpcenter">{t.admin.kb.kindHelpCenter}</option>
        </Select>
      </Field>

      <Field
        id="connector-url"
        label={t.admin.kb.url}
        hint={
          kind === "sitemap"
            ? t.admin.kb.urlHintSitemap
            : kind === "helpcenter"
              ? t.admin.kb.urlHintHelpCenter
              : t.admin.kb.urlHintPrefix
        }
        error={state.fieldErrors?.url}
      >
        <Input
          id="connector-url"
          name="url"
          type="url"
          required
          placeholder="https://"
          key={state.ok ? "cleared" : "url"}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="connector-interval"
          label={t.admin.kb.interval}
          hint={t.admin.kb.intervalHint}
          error={state.fieldErrors?.intervalHours}
        >
          <Input
            id="connector-interval"
            name="intervalHours"
            type="number"
            min={1}
            max={8760}
            defaultValue={168}
          />
        </Field>
        <Field
          id="connector-max"
          label={t.admin.kb.maxPages}
          error={state.fieldErrors?.maxPages}
        >
          <Input
            id="connector-max"
            name="maxPages"
            type="number"
            min={1}
            max={20000}
            defaultValue={500}
          />
        </Field>
      </div>

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? t.common.saving : t.admin.kb.addConnectorSubmit}
        </Button>
      </div>
    </form>
  );
}
