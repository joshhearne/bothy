"use client";

import { useEffect, useRef, useState } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/alert";
import type { FormState } from "@/lib/form";
import { addTemplateFieldAction, updateTemplateFieldAction } from "./actions";

export type FieldTypeChoice = {
  value: string;
  label: string;
  usesOptionList: boolean;
  usesLinkDocType: boolean;
};
export type OptionListChoice = { id: string; name: string };
export type DocTypeChoice = { id: string; name: string };

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

function Controls({
  fieldTypes,
  optionLists,
  docTypes,
  fieldErrors,
  defaults,
}: {
  fieldTypes: FieldTypeChoice[];
  optionLists: OptionListChoice[];
  docTypes: DocTypeChoice[];
  fieldErrors: Record<string, string>;
  defaults: {
    label?: string;
    fieldType?: string;
    optionListId?: string | null;
    linkDocTypeId?: string | null;
    required?: boolean;
  };
}) {
  const [fieldType, setFieldType] = useState(defaults.fieldType ?? "text");
  const choice = fieldTypes.find((t) => t.value === fieldType);
  const needsList = choice?.usesOptionList ?? false;
  const needsDocType = choice?.usesLinkDocType ?? false;

  return (
    <>
      <Field id="label" label="Label" error={fieldErrors.label}>
        <Input
          id="label"
          name="label"
          defaultValue={defaults.label ?? ""}
          required
          maxLength={200}
          aria-invalid={!!fieldErrors.label}
        />
      </Field>

      <Field id="fieldType" label="Type" error={fieldErrors.fieldType}>
        <select
          id="fieldType"
          name="fieldType"
          value={fieldType}
          onChange={(event) => setFieldType(event.target.value)}
          className="h-10 w-full rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          {fieldTypes.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </select>
      </Field>

      {needsList && (
        <Field id="optionListId" label="Option list" error={fieldErrors.optionListId}>
          <select
            id="optionListId"
            name="optionListId"
            defaultValue={defaults.optionListId ?? ""}
            className="h-10 w-full rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            <option value="">Choose a list…</option>
            {optionLists.map((list) => (
              <option key={list.id} value={list.id}>
                {list.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      {needsDocType && (
        <Field
          id="linkDocTypeId"
          label="Links to"
          error={fieldErrors.linkDocTypeId}
          hint="Restricts the picker to documents of one type in the same company."
        >
          <select
            id="linkDocTypeId"
            name="linkDocTypeId"
            defaultValue={defaults.linkDocTypeId ?? ""}
            className="h-10 w-full rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            <option value="">Any document in this company</option>
            {docTypes.map((docType) => (
              <option key={docType.id} value={docType.id}>
                {docType.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="required"
          defaultChecked={defaults.required ?? false}
          className="size-4 rounded border"
        />
        Required
      </label>
    </>
  );
}

export function AddTemplateFieldForm({
  docTypeId,
  fieldTypes,
  optionLists,
  docTypes,
}: {
  docTypeId: string;
  fieldTypes: FieldTypeChoice[];
  optionLists: OptionListChoice[];
  docTypes: DocTypeChoice[];
}) {
  const [state, formAction] = useActionState<FormState, FormData>(addTemplateFieldAction, {});
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="flex flex-col gap-4 rounded-md border border-dashed p-4"
    >
      <FormError>{state.error}</FormError>
      <input type="hidden" name="docTypeId" value={docTypeId} />
      <h3 className="text-sm font-semibold">Add a template field</h3>
      <Controls
        fieldTypes={fieldTypes}
        optionLists={optionLists}
        docTypes={docTypes}
        fieldErrors={state.fieldErrors ?? {}}
        defaults={{}}
      />
      <div>
        <Submit label="Add field" />
      </div>
    </form>
  );
}

export function EditTemplateFieldForm({
  docTypeId,
  field,
  fieldTypes,
  optionLists,
  docTypes,
}: {
  docTypeId: string;
  field: {
    id: string;
    label: string;
    fieldType: string;
    optionListId: string | null;
    linkDocTypeId: string | null;
    required: boolean;
  };
  fieldTypes: FieldTypeChoice[];
  optionLists: OptionListChoice[];
  docTypes: DocTypeChoice[];
}) {
  const [state, formAction] = useActionState<FormState, FormData>(updateTemplateFieldAction, {});

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-5">
      <FormError>{state.error}</FormError>
      <input type="hidden" name="id" value={field.id} />
      <input type="hidden" name="docTypeId" value={docTypeId} />
      <Controls
        fieldTypes={fieldTypes}
        optionLists={optionLists}
        docTypes={docTypes}
        fieldErrors={state.fieldErrors ?? {}}
        defaults={field}
      />
      <div>
        <Submit label="Save field" />
      </div>
    </form>
  );
}
