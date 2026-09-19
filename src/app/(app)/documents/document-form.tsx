"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/alert";
import {
  FieldControl,
  FieldLabel,
  toFormValue,
  type EditableField,
  type FieldFormValue,
  type FieldOption,
} from "@/components/fields/field-control";
import type { FormState } from "@/lib/form";
import { createDocumentAction } from "./actions";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

/**
 * Create form. Fields come from the doc type's template; local fields and
 * reordering arrive once the document exists, in the inline editor.
 */
export function DocumentForm({
  companyId,
  docTypeId,
  locationId,
  fields,
  options,
  linkTargets,
}: {
  companyId: string;
  docTypeId: string;
  locationId: string | null;
  fields: EditableField[];
  options: Record<string, FieldOption[]>;
  /** Documents each doc_link field may point at, keyed by field id. */
  linkTargets: Record<string, FieldOption[]>;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(createDocumentAction, {});
  const [values, setValues] = useState<Record<string, FieldFormValue>>(() =>
    Object.fromEntries(fields.map((field) => [field.id, toFormValue(field.fieldType, null)])),
  );
  const fieldErrors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex max-w-2xl flex-col gap-6">
      <FormError>{state.error}</FormError>
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="docTypeId" value={docTypeId} />
      {locationId && <input type="hidden" name="locationId" value={locationId} />}

      <Field id="title" label="Title" error={fieldErrors.title}>
        <Input id="title" name="title" required maxLength={300} autoFocus aria-invalid={!!fieldErrors.title} />
      </Field>

      {fields.map((field) => (
        <div key={field.id} className="flex flex-col gap-2">
          <FieldLabel field={field} />
          <FieldControl
            field={field}
            value={values[field.id] ?? toFormValue(field.fieldType, null)}
            onChange={(next) => setValues((current) => ({ ...current, [field.id]: next }))}
            options={
              field.fieldType === "doc_link"
                ? (linkTargets[field.id] ?? [])
                : field.optionListId
                  ? (options[field.optionListId] ?? [])
                  : []
            }
            error={fieldErrors[field.id]}
          />
        </div>
      ))}

      <div>
        <Submit label="Create document" />
      </div>
    </form>
  );
}
