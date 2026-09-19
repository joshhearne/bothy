"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/alert";
import { FieldInput, type EditableField, type FieldOption } from "@/components/fields/field-input";
import type { FormState } from "@/lib/form";
import { createDocumentAction, saveDocumentAction } from "./actions";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

export type DocumentFormProps = {
  mode: "create" | "edit";
  submitLabel: string;
  title: string;
  fields: EditableField[];
  values: Record<string, unknown>;
  options: Record<string, FieldOption[]>;
  /** create mode */
  companyId?: string;
  docTypeId?: string;
  locationId?: string | null;
  /** edit mode */
  documentId?: string;
};

export function DocumentForm({
  mode,
  submitLabel,
  title,
  fields,
  values,
  options,
  companyId,
  docTypeId,
  locationId,
  documentId,
}: DocumentFormProps) {
  const action = mode === "create" ? createDocumentAction : saveDocumentAction;
  const [state, formAction] = useActionState<FormState, FormData>(action, {});
  const fieldErrors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex max-w-2xl flex-col gap-6">
      <FormError>{state.error}</FormError>

      {mode === "create" ? (
        <>
          <input type="hidden" name="companyId" value={companyId ?? ""} />
          <input type="hidden" name="docTypeId" value={docTypeId ?? ""} />
          {locationId && <input type="hidden" name="locationId" value={locationId} />}
        </>
      ) : (
        <input type="hidden" name="documentId" value={documentId ?? ""} />
      )}

      <Field id="title" label="Title" error={fieldErrors.title}>
        <Input
          id="title"
          name="title"
          defaultValue={title}
          required
          maxLength={300}
          autoFocus={mode === "create"}
          aria-invalid={!!fieldErrors.title}
        />
      </Field>

      {fields.map((field) => (
        <FieldInput
          key={field.id}
          field={field}
          value={values[field.id] ?? null}
          options={field.optionListId ? (options[field.optionListId] ?? []) : []}
          error={fieldErrors[field.id]}
        />
      ))}

      <div>
        <Submit label={submitLabel} />
      </div>
    </form>
  );
}
