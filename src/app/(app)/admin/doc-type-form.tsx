"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/alert";
import type { FormState } from "@/lib/form";
import { useMessages } from "@/i18n/client";
import { createDocTypeAction, updateDocTypeAction } from "./actions";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  const t = useMessages();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? t.common.saving : label}
    </Button>
  );
}

export function DocTypeForm({
  values = {},
  submitLabel,
}: {
  values?: { id?: string; name?: string; icon?: string | null; scope?: string };
  submitLabel: string;
}) {
  const action = values.id ? updateDocTypeAction : createDocTypeAction;
  const [state, formAction] = useActionState<FormState, FormData>(action, {});
  const fieldErrors = state.fieldErrors ?? {};
  const t = useMessages();

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-5">
      <FormError>{state.error}</FormError>
      {state.ok && <p className="text-sm text-[var(--muted-foreground)]">{t.common.saved}</p>}
      {values.id && <input type="hidden" name="id" value={values.id} />}

      <Field id="name" label={t.common.name} error={fieldErrors.name}>
        <Input
          id="name"
          name="name"
          defaultValue={values.name ?? ""}
          required
          maxLength={200}
          aria-invalid={!!fieldErrors.name}
        />
      </Field>

      <Field
        id="scope"
        label={t.admin.docTypes.scope}
        error={fieldErrors.scope}
        hint={t.admin.docTypes.scopeHint}
      >
        <select
          id="scope"
          name="scope"
          defaultValue={values.scope ?? "location"}
          className="h-10 w-full rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          <option value="location">Location</option>
          <option value="company">Company</option>
        </select>
      </Field>

      <Field id="icon" label={t.admin.docTypes.icon} error={fieldErrors.icon} hint={t.admin.docTypes.iconHint}>
        <Input id="icon" name="icon" defaultValue={values.icon ?? ""} maxLength={64} />
      </Field>

      <div>
        <Submit label={submitLabel} />
      </div>
    </form>
  );
}
