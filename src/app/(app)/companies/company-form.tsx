"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/alert";
import type { FormState } from "@/lib/form";
import { createCompanyAction, updateCompanyAction } from "./actions";

export type CompanyFormValues = {
  id?: string;
  name?: string;
  isInternal?: boolean;
  notes?: string | null;
};

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

export function CompanyForm({
  values = {},
  submitLabel,
}: {
  values?: CompanyFormValues;
  submitLabel: string;
}) {
  const action = values.id ? updateCompanyAction : createCompanyAction;
  const [state, formAction] = useActionState<FormState, FormData>(action, {});
  const fieldErrors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-5">
      <FormError>{state.error}</FormError>
      {values.id && <input type="hidden" name="id" value={values.id} />}

      <Field id="name" label="Name" error={fieldErrors.name}>
        <Input
          id="name"
          name="name"
          defaultValue={values.name ?? ""}
          required
          maxLength={200}
          autoFocus
          aria-invalid={!!fieldErrors.name}
        />
      </Field>

      <Field id="notes" label="Notes" error={fieldErrors.notes} hint="Markdown is supported.">
        <Textarea id="notes" name="notes" defaultValue={values.notes ?? ""} rows={6} />
      </Field>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="isInternal"
          defaultChecked={values.isInternal ?? false}
          className="size-4 rounded border"
        />
        This is my own organization
      </label>

      <div className="flex gap-2">
        <SubmitButton label={submitLabel} />
      </div>
    </form>
  );
}
