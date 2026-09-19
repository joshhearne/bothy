"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RichTextEditor } from "@/components/fields/rich-text-editor";
import type { FieldType } from "@/server/fields/types";

export type EditableField = {
  id: string;
  label: string;
  fieldType: FieldType;
  required: boolean;
  optionListId: string | null;
  isLocal: boolean;
};

export type FieldOption = { id: string; label: string };

/** Mirrors fieldInputName() on the server: values are keyed by field UUID. */
function inputName(fieldId: string): string {
  return `field:${fieldId}`;
}

export function FieldInput({
  field,
  value,
  options,
  error,
}: {
  field: EditableField;
  value: unknown;
  options: FieldOption[];
  error?: string | undefined;
}) {
  const name = inputName(field.id);
  const id = `f-${field.id}`;
  const invalid = !!error;
  const asString = value === null || value === undefined ? "" : String(value);
  const selected = new Set(Array.isArray(value) ? value.map(String) : []);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Label htmlFor={id} id={`${id}-label`}>
          {field.label}
          {field.required && <span className="text-[var(--destructive)]"> *</span>}
        </Label>
        {field.isLocal && (
          <span className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
            This document
          </span>
        )}
      </div>

      {renderControl()}

      {error && <p className="text-sm text-[var(--destructive)]">{error}</p>}
    </div>
  );

  function renderControl() {
    switch (field.fieldType) {
      case "markdown":
      case "richtext":
        return (
          <RichTextEditor
            name={name}
            mode={field.fieldType}
            defaultValue={asString}
            ariaLabelledBy={`${id}-label`}
          />
        );

      case "boolean":
        return (
          <label className="flex items-center gap-2 text-sm">
            {/* Keeps the field present in the form even when unticked. */}
            <input type="hidden" name={name} value="" />
            <input
              id={id}
              type="checkbox"
              name={name}
              value="on"
              defaultChecked={value === true}
              className="size-4 rounded border"
            />
            Yes
          </label>
        );

      case "number":
        return (
          <Input
            id={id}
            name={name}
            type="number"
            step="any"
            defaultValue={asString}
            required={field.required}
            aria-invalid={invalid}
          />
        );

      case "date":
        return (
          <Input
            id={id}
            name={name}
            type="date"
            defaultValue={asString}
            required={field.required}
            aria-invalid={invalid}
          />
        );

      case "url":
        return (
          <Input
            id={id}
            name={name}
            type="url"
            inputMode="url"
            placeholder="https://"
            defaultValue={asString}
            required={field.required}
            aria-invalid={invalid}
          />
        );

      case "dropdown":
        return (
          <select
            id={id}
            name={name}
            defaultValue={asString}
            required={field.required}
            aria-invalid={invalid}
            className="h-10 w-full rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            <option value="">—</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        );

      case "multi_dropdown":
        return (
          <fieldset
            aria-labelledby={`${id}-label`}
            className="flex flex-col gap-1 rounded-md border p-3"
          >
            {/* Keeps the field present when every box is cleared. */}
            <input type="hidden" name={name} value="" />
            {options.length === 0 && (
              <p className="text-sm text-[var(--muted-foreground)]">This list has no options yet.</p>
            )}
            {options.map((option) => (
              <label key={option.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name={name}
                  value={option.id}
                  defaultChecked={selected.has(option.id)}
                  className="size-4 rounded border"
                />
                {option.label}
              </label>
            ))}
          </fieldset>
        );

      case "doc_link":
      case "secret_ref":
        return (
          <p className="rounded-md border border-dashed px-3 py-2 text-sm text-[var(--muted-foreground)]">
            This field type is not editable yet.
          </p>
        );

      default:
        return (
          <Input
            id={id}
            name={name}
            defaultValue={asString}
            required={field.required}
            aria-invalid={invalid}
          />
        );
    }
  }
}
