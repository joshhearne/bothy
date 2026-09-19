"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/alert";
import type { FormState } from "@/lib/form";
import { createDocTypeAction, updateDocTypeAction } from "./actions";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : label}
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

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-5">
      <FormError>{state.error}</FormError>
      {state.ok && <p className="text-sm text-[var(--muted-foreground)]">Saved.</p>}
      {values.id && <input type="hidden" name="id" value={values.id} />}

      <Field id="name" label="Name" error={fieldErrors.name}>
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
        label="Scope"
        error={fieldErrors.scope}
        hint="Company documents attach to the company. Location documents attach to one site."
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

      <Field id="icon" label="Icon" error={fieldErrors.icon} hint="Optional lucide icon name.">
        <Input id="icon" name="icon" defaultValue={values.icon ?? ""} maxLength={64} />
      </Field>

      <div>
        <Submit label={submitLabel} />
      </div>
    </form>
  );
}
