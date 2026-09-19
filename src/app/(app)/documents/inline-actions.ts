"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { toFieldErrors } from "@/lib/form";
import {
  canEditDocuments,
  canManageDocTypes,
  ForbiddenError,
  requireUser,
  type CurrentUser,
} from "@/server/auth/session";
import { NotFoundError } from "@/server/services/companies";
import type { EditableFieldType, FieldDefinition, FieldType } from "@/server/fields/types";
import {
  addLocalField,
  applyOrderToTemplate,
  archiveFieldInline,
  getFieldOwnership,
  NotALocalFieldError,
  promoteField,
  setDocumentFieldOrder,
} from "@/server/services/inline-fields";
import { addOptionItem, DuplicateOptionError } from "@/server/services/option-lists";

/**
 * Inline editing actions. These are called straight from the editor rather than
 * by submitting the form, so unsaved field values are never thrown away.
 */

export type InlineResult<T> =
  | { ok: true; data: T }
  | { ok: false; error?: string; fieldErrors?: Record<string, string> };

export type InlineFieldPayload = {
  id: string;
  label: string;
  fieldType: FieldType;
  optionListId: string | null;
  linkDocTypeId: string | null;
  required: boolean;
  isLocal: boolean;
};

function toPayload(field: FieldDefinition): InlineFieldPayload {
  return {
    id: field.id,
    label: field.label,
    fieldType: field.fieldType,
    optionListId: field.optionListId,
    linkDocTypeId: field.linkDocTypeId,
    required: field.required,
    isLocal: field.documentId !== null,
  };
}

function toError(err: unknown): InlineResult<never> {
  if (err instanceof ZodError) return { ok: false, fieldErrors: toFieldErrors(err) };
  if (err instanceof ForbiddenError) return { ok: false, error: err.message };
  if (err instanceof NotFoundError) return { ok: false, error: err.message };
  if (err instanceof NotALocalFieldError) return { ok: false, error: err.message };
  if (err instanceof DuplicateOptionError) return { ok: false, fieldErrors: { label: err.message } };
  throw err;
}

async function editor(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!canEditDocuments(user.role)) throw new ForbiddenError();
  return user;
}

export type FieldDraft = {
  label: string;
  /** secret_ref is not editable yet, so it cannot be drafted. */
  fieldType: EditableFieldType;
  optionListId: string | null;
  linkDocTypeId: string | null;
  required: boolean;
};

/** Rule 2: "Add field" in edit mode creates a local field on that document. */
export async function addLocalFieldAction(
  documentId: string,
  draft: FieldDraft,
): Promise<InlineResult<InlineFieldPayload>> {
  try {
    const user = await editor();
    const field = await addLocalField(documentId, draft, user.id);
    revalidatePath(`/documents/${documentId}`);
    return { ok: true, data: toPayload(field) };
  } catch (err) {
    return toError(err);
  }
}

/** Rule 3: promoting a local field onto its doc type, admin or tech. */
export async function promoteFieldAction(
  documentId: string,
  fieldId: string,
  draft: FieldDraft,
): Promise<InlineResult<InlineFieldPayload>> {
  try {
    const user = await editor();
    const field = await promoteField(fieldId, draft, user.id);
    revalidatePath(`/documents/${documentId}`);
    return { ok: true, data: toPayload(field) };
  } catch (err) {
    return toError(err);
  }
}

/** Rule 4: the "+" beside a dropdown, writing to the shared option list. */
export async function addOptionItemInlineAction(
  documentId: string,
  listId: string,
  label: string,
): Promise<InlineResult<{ id: string; label: string }>> {
  try {
    const user = await editor();
    const item = await addOptionItem(listId, { label }, user.id);
    revalidatePath(`/documents/${documentId}`);
    return { ok: true, data: item };
  } catch (err) {
    return toError(err);
  }
}

/**
 * Rule 5: after a drag, the editor asks "this doc only" or "update template".
 * Changing the template itself is doc type surgery, so it needs an admin.
 */
export async function reorderFieldsAction(
  documentId: string,
  docTypeId: string,
  orderedFieldIds: string[],
  scope: "document" | "template",
): Promise<InlineResult<{ scope: "document" | "template" }>> {
  try {
    const user = await editor();

    if (scope === "template") {
      if (!canManageDocTypes(user.role)) {
        return {
          ok: false,
          error: "Only an administrator can change the order for every document of this type",
        };
      }
      await applyOrderToTemplate(documentId, docTypeId, orderedFieldIds, user.id);
    } else {
      await setDocumentFieldOrder(documentId, orderedFieldIds, user.id);
    }

    revalidatePath(`/documents/${documentId}`);
    return { ok: true, data: { scope } };
  } catch (err) {
    return toError(err);
  }
}

/**
 * Rule 6: archiving hides the field everywhere and keeps its stored values.
 * A local field belongs to this document, so a tech who added one can remove
 * it; archiving a template field affects every document, so that needs admin.
 */
export async function archiveFieldAction(
  documentId: string,
  fieldId: string,
): Promise<InlineResult<{ id: string }>> {
  try {
    const user = await editor();

    const ownership = await getFieldOwnership(fieldId);
    if (!ownership) return { ok: false, error: "Field not found" };

    if (ownership.docTypeId && !canManageDocTypes(user.role)) {
      return {
        ok: false,
        error: "Only an administrator can archive a template field",
      };
    }

    await archiveFieldInline(fieldId, user.id);
    revalidatePath(`/documents/${documentId}`);
    return { ok: true, data: { id: fieldId } };
  } catch (err) {
    return toError(err);
  }
}
