"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus } from "lucide-react";
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
import type { EditableFieldType } from "@/server/fields/types";
import { saveDocumentAction } from "../../actions";
import {
  addLocalFieldAction,
  addOptionItemInlineAction,
  archiveFieldAction,
  promoteFieldAction,
  reorderFieldsAction,
  type FieldDraft,
} from "../../inline-actions";

export type FieldTypeChoice = {
  value: EditableFieldType;
  label: string;
  usesOptionList: boolean;
  usesLinkDocType: boolean;
};
export type OptionListChoice = { id: string; name: string };
export type DocTypeChoice = { id: string; name: string };

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save document"}
    </Button>
  );
}

/**
 * The inline editor. Every structural change — adding a field, promoting one,
 * adding a dropdown option, reordering, archiving — happens here without
 * leaving the document, and without discarding values already typed.
 */
export function DocumentEditor({
  documentId,
  docTypeId,
  docTypeName,
  initialTitle,
  initialFields,
  initialValues,
  initialOptions,
  fieldTypes,
  optionLists,
  docTypeChoices,
  linkTargets,
  canManageTemplate,
}: {
  documentId: string;
  docTypeId: string;
  docTypeName: string;
  initialTitle: string;
  initialFields: EditableField[];
  initialValues: Record<string, unknown>;
  initialOptions: Record<string, FieldOption[]>;
  fieldTypes: FieldTypeChoice[];
  optionLists: OptionListChoice[];
  docTypeChoices: DocTypeChoice[];
  /** Documents each doc_link field may point at, keyed by field id. */
  linkTargets: Record<string, FieldOption[]>;
  canManageTemplate: boolean;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(saveDocumentAction, {});
  const [fields, setFields] = useState(initialFields);
  const [values, setValues] = useState<Record<string, FieldFormValue>>(() =>
    Object.fromEntries(
      initialFields.map((field) => [field.id, toFormValue(field.fieldType, initialValues[field.id])]),
    ),
  );
  const [options, setOptions] = useState(initialOptions);
  const [notice, setNotice] = useState<string | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [pendingOrder, setPendingOrder] = useState<
    { order: string[]; previous: EditableField[] } | null
  >(null);
  const [promoting, setPromoting] = useState<EditableField | null>(null);
  const [addingField, setAddingField] = useState(false);
  const [isPending, startTransition] = useTransition();

  const fieldErrors = state.fieldErrors ?? {};

  function optionsFor(field: EditableField): FieldOption[] {
    if (field.fieldType === "doc_link") return linkTargets[field.id] ?? [];
    return field.optionListId ? (options[field.optionListId] ?? []) : [];
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function report(result: { ok: boolean; error?: string | undefined }, success: string): boolean {
    if (result.ok) {
      setInlineError(null);
      setNotice(success);
      return true;
    }
    setNotice(null);
    setInlineError(result.error ?? "That did not work");
    return false;
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const from = fields.findIndex((field) => field.id === active.id);
    const to = fields.findIndex((field) => field.id === over.id);
    if (from < 0 || to < 0) return;

    const reordered = arrayMove(fields, from, to);
    setFields(reordered);
    const order = reordered.map((field) => field.id);
    const movedTemplateField = fields[from]?.isLocal === false;

    // Rule 5: moving a template field asks whether this is a one-document
    // change or a change to the template itself. Cancelling puts the order back
    // the way it was before this drag.
    if (movedTemplateField) {
      setPendingOrder({ order, previous: fields });
      return;
    }

    startTransition(async () => {
      const result = await reorderFieldsAction(documentId, docTypeId, order, "document");
      report(result, "Field order saved for this document.");
    });
  }

  function persistOrder(scope: "document" | "template") {
    const order = pendingOrder?.order;
    if (!order) return;
    setPendingOrder(null);
    startTransition(async () => {
      const result = await reorderFieldsAction(documentId, docTypeId, order, scope);
      report(
        result,
        scope === "template"
          ? `Field order updated for every ${docTypeName} document.`
          : "Field order saved for this document.",
      );
    });
  }

  async function addOption(listId: string, label: string): Promise<FieldOption | null> {
    const result = await addOptionItemInlineAction(documentId, listId, label);
    if (!result.ok) {
      setNotice(null);
      setInlineError(result.error ?? result.fieldErrors?.label ?? "Could not add that option");
      return null;
    }
    setInlineError(null);
    setNotice(`Added "${result.data.label}".`);
    setOptions((current) => ({
      ...current,
      [listId]: [...(current[listId] ?? []), result.data],
    }));
    return result.data;
  }

  return (
    <div className="flex flex-col gap-6">
      {(notice || inlineError) && (
        <div aria-live="polite" className="flex flex-col gap-2">
          {inlineError && <FormError>{inlineError}</FormError>}
          {notice && !inlineError && (
            <p className="rounded-md border px-3 py-2 text-sm text-[var(--muted-foreground)]">
              {notice}
            </p>
          )}
        </div>
      )}

      {pendingOrder && (
        <div
          role="group"
          aria-label="Apply new field order"
          className="flex flex-wrap items-center gap-3 rounded-md border px-4 py-3"
        >
          <p className="text-sm">Apply this order to…</p>
          <Button type="button" size="sm" variant="outline" onClick={() => persistOrder("document")}>
            This document only
          </Button>
          {canManageTemplate && (
            <Button type="button" size="sm" onClick={() => persistOrder("template")}>
              Update template
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setFields(pendingOrder.previous);
              setPendingOrder(null);
            }}
          >
            Cancel
          </Button>
        </div>
      )}

      <form action={formAction} className="flex max-w-2xl flex-col gap-6">
        <FormError>{state.error}</FormError>
        <input type="hidden" name="documentId" value={documentId} />

        <Field id="title" label="Title" error={fieldErrors.title}>
          <Input
            id="title"
            name="title"
            defaultValue={initialTitle}
            required
            maxLength={300}
            aria-invalid={!!fieldErrors.title}
          />
        </Field>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext
            items={fields.map((field) => field.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="flex flex-col gap-4">
              {fields.map((field) => (
                <SortableField
                  key={field.id}
                  field={field}
                  value={values[field.id] ?? toFormValue(field.fieldType, null)}
                  onChange={(next) => setValues((current) => ({ ...current, [field.id]: next }))}
                  options={optionsFor(field)}
                  error={fieldErrors[field.id]}
                  busy={isPending}
                  canArchive={field.isLocal || canManageTemplate}
                  onAddOption={
                    field.optionListId
                      ? (label) => addOption(field.optionListId as string, label)
                      : undefined
                  }
                  onPromote={() => setPromoting(field)}
                  onArchive={() =>
                    startTransition(async () => {
                      const result = await archiveFieldAction(documentId, field.id);
                      if (report(result, `Archived ${field.label}.`)) {
                        setFields((current) => current.filter((item) => item.id !== field.id));
                      }
                    })
                  }
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>

        <div>
          <SaveButton />
        </div>
      </form>

      {promoting && (
        <FieldDraftPanel
          heading={`Add "${promoting.label}" to the ${docTypeName} template`}
          description="Confirm the label, type, and option list. Every document of this type gains the field, empty."
          submitLabel="Add to template"
          fieldTypes={fieldTypes}
          optionLists={optionLists}
          docTypes={docTypeChoices}
          busy={isPending}
          initial={{
            label: promoting.label,
            fieldType: promoting.fieldType as EditableFieldType,
            optionListId: promoting.optionListId,
            linkDocTypeId: promoting.linkDocTypeId,
            required: promoting.required,
          }}
          onCancel={() => setPromoting(null)}
          onSubmit={(draft) =>
            startTransition(async () => {
              const result = await promoteFieldAction(documentId, promoting.id, draft);
              if (result.ok) {
                const promoted = result.data;
                setFields((current) =>
                  current.map((item) => (item.id === promoted.id ? promoted : item)),
                );
                setPromoting(null);
                report(result, `"${promoted.label}" is now part of the template.`);
              } else {
                report(result, "");
              }
            })
          }
        />
      )}

      {addingField ? (
        <FieldDraftPanel
          heading="Add a field to this document"
          description="It belongs to this document only until you add it to the template."
          submitLabel="Add field"
          fieldTypes={fieldTypes}
          optionLists={optionLists}
          docTypes={docTypeChoices}
          busy={isPending}
          initial={{
            label: "",
            fieldType: "text",
            optionListId: null,
            linkDocTypeId: null,
            required: false,
          }}
          onCancel={() => setAddingField(false)}
          onSubmit={(draft) =>
            startTransition(async () => {
              const result = await addLocalFieldAction(documentId, draft);
              if (result.ok) {
                const field = result.data;
                setFields((current) => [...current, field]);
                setValues((current) => ({
                  ...current,
                  [field.id]: toFormValue(field.fieldType, null),
                }));
                setAddingField(false);
                report(result, `Added ${field.label}.`);
              } else {
                report(result, "");
              }
            })
          }
        />
      ) : (
        <div>
          <Button type="button" variant="outline" onClick={() => setAddingField(true)}>
            <Plus className="size-4" aria-hidden />
            Add field
          </Button>
        </div>
      )}
    </div>
  );
}

function SortableField({
  field,
  value,
  onChange,
  options,
  error,
  busy,
  canArchive,
  onAddOption,
  onPromote,
  onArchive,
}: {
  field: EditableField;
  value: FieldFormValue;
  onChange: (next: FieldFormValue) => void;
  options: FieldOption[];
  error?: string | undefined;
  busy: boolean;
  canArchive: boolean;
  onAddOption?: ((label: string) => Promise<FieldOption | null>) | undefined;
  onPromote: () => void;
  onArchive: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: field.id,
  });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? "opacity-60" : undefined}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          aria-label={`Reorder ${field.label}`}
          className="mt-1 cursor-grab rounded p-1 text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" aria-hidden />
        </button>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <FieldLabel field={field} />
            <div className="flex items-center gap-1">
              {field.isLocal && (
                <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onPromote}>
                  Add to template
                </Button>
              )}
              {canArchive && (
                <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onArchive}>
                  Archive
                </Button>
              )}
            </div>
          </div>

          <FieldControl
            field={field}
            value={value}
            onChange={onChange}
            options={options}
            error={error}
            onAddOption={onAddOption}
          />
        </div>
      </div>
    </li>
  );
}

/** Shared by "Add field" and "Add to template", which ask for the same things. */
function FieldDraftPanel({
  heading,
  description,
  submitLabel,
  fieldTypes,
  optionLists,
  docTypes,
  initial,
  busy,
  onSubmit,
  onCancel,
}: {
  heading: string;
  description: string;
  submitLabel: string;
  fieldTypes: FieldTypeChoice[];
  optionLists: OptionListChoice[];
  docTypes: DocTypeChoice[];
  initial: FieldDraft;
  busy: boolean;
  onSubmit: (draft: FieldDraft) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(initial.label);
  const [fieldType, setFieldType] = useState<EditableFieldType>(initial.fieldType);
  const [optionListId, setOptionListId] = useState(initial.optionListId ?? "");
  const [linkDocTypeId, setLinkDocTypeId] = useState(initial.linkDocTypeId ?? "");
  const [required, setRequired] = useState(initial.required);

  const choice = fieldTypes.find((type) => type.value === fieldType);
  const needsList = choice?.usesOptionList ?? false;
  const needsDocType = choice?.usesLinkDocType ?? false;

  return (
    <section
      aria-label={heading}
      className="flex max-w-2xl flex-col gap-4 rounded-md border border-dashed p-4"
    >
      <div>
        <h2 className="text-sm font-semibold">{heading}</h2>
        <p className="text-sm text-[var(--muted-foreground)]">{description}</p>
      </div>

      <Field id="draft-label" label="Label">
        <Input
          id="draft-label"
          value={label}
          autoFocus
          maxLength={200}
          onChange={(event) => setLabel(event.target.value)}
        />
      </Field>

      <Field id="draft-type" label="Type">
        <select
          id="draft-type"
          value={fieldType}
          onChange={(event) => setFieldType(event.target.value as EditableFieldType)}
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
        <Field id="draft-list" label="Option list">
          <select
            id="draft-list"
            value={optionListId}
            onChange={(event) => setOptionListId(event.target.value)}
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
        <Field id="draft-doc-type" label="Links to">
          <select
            id="draft-doc-type"
            value={linkDocTypeId}
            onChange={(event) => setLinkDocTypeId(event.target.value)}
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
          checked={required}
          onChange={(event) => setRequired(event.target.checked)}
          className="size-4 rounded border"
        />
        Required
      </label>

      <div className="flex gap-2">
        <Button
          type="button"
          disabled={busy || label.trim() === ""}
          onClick={() =>
            onSubmit({
              label: label.trim(),
              fieldType,
              optionListId: needsList ? optionListId || null : null,
              linkDocTypeId: needsDocType ? linkDocTypeId || null : null,
              required,
            })
          }
        >
          {busy ? "Saving…" : submitLabel}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </section>
  );
}
