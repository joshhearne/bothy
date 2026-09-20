"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { text, toFieldErrors, type FormState } from "@/lib/form";
import {
  ForbiddenError,
  getCompanyScope,
  requireDocumentEditor,
} from "@/server/auth/session";
import { NotFoundError } from "@/server/services/companies";
import { listTemplateFields } from "@/server/services/doc-types";
import {
  archiveDocument,
  createDocument,
  getDocumentDetail,
  saveDocument,
  ScopeMismatchError,
  unarchiveDocument,
} from "@/server/services/documents";
import { readRawValues } from "@/server/fields/form";
import {
  addAttachment,
  EmptyUploadError,
  removeAttachment,
  UploadTooLargeError,
} from "@/server/services/attachments";
import {
  ConversionFailedError,
  ConversionUnavailableError,
  MacroEnabledError,
  UnsupportedFileError,
} from "@/server/uploads/accept";

function toFormState(err: unknown): FormState {
  if (err instanceof ZodError) return { fieldErrors: toFieldErrors(err) };
  if (err instanceof UploadTooLargeError) return { error: err.message };
  if (err instanceof EmptyUploadError) return { error: err.message };
  // Each of these says what to do about it, so the message is the whole answer.
  if (err instanceof UnsupportedFileError) return { error: err.message };
  if (err instanceof MacroEnabledError) return { error: err.message };
  if (err instanceof ConversionUnavailableError) return { error: err.message };
  if (err instanceof ConversionFailedError) return { error: err.message };
  if (err instanceof ForbiddenError) return { error: err.message };
  if (err instanceof NotFoundError) return { error: err.message };
  if (err instanceof ScopeMismatchError) return { error: err.message };
  throw err;
}

export async function createDocumentAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const companyId = text(formData, "companyId");
  const docTypeId = text(formData, "docTypeId");
  if (!companyId || !docTypeId) return { error: "Choose a doc type first" };

  let documentId: string;
  try {
    const user = await requireDocumentEditor();
    const scope = await getCompanyScope(user);
    const templateFields = await listTemplateFields(docTypeId);

    const result = await createDocument(
      {
        companyId,
        docTypeId,
        locationId: text(formData, "locationId") ?? null,
        title: text(formData, "title") ?? "",
        values: readRawValues(formData, templateFields),
      },
      user.id,
      scope,
    );

    if (!result.ok) return { fieldErrors: result.errors };
    documentId = result.id;
  } catch (err) {
    return toFormState(err);
  }

  revalidatePath(`/companies/${companyId}`);
  redirect(`/documents/${documentId}`);
}

export async function saveDocumentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const documentId = text(formData, "documentId");
  if (!documentId) return { error: "Missing document" };

  let companyId: string;
  try {
    const user = await requireDocumentEditor();
    const scope = await getCompanyScope(user);
    const detail = await getDocumentDetail(documentId, scope);
    if (!detail) return { error: "Document not found" };
    companyId = detail.document.companyId;

    const result = await saveDocument(
      documentId,
      { title: text(formData, "title") ?? "", values: readRawValues(formData, detail.fields) },
      user.id,
      scope,
    );

    if (!result.ok) return { fieldErrors: result.errors };
  } catch (err) {
    return toFormState(err);
  }

  revalidatePath(`/companies/${companyId}`);
  revalidatePath(`/documents/${documentId}`);
  redirect(`/documents/${documentId}`);
}

export async function archiveDocumentAction(formData: FormData): Promise<void> {
  const documentId = text(formData, "documentId");
  const companyId = text(formData, "companyId");
  if (!documentId || !companyId) return;

  const user = await requireDocumentEditor();
    const scope = await getCompanyScope(user);
  await archiveDocument(documentId, user.id, scope);

  revalidatePath(`/companies/${companyId}`);
  redirect(`/companies/${companyId}`);
}

export async function unarchiveDocumentAction(formData: FormData): Promise<void> {
  const documentId = text(formData, "documentId");
  const companyId = text(formData, "companyId");
  if (!documentId || !companyId) return;

  const user = await requireDocumentEditor();
    const scope = await getCompanyScope(user);
  await unarchiveDocument(documentId, user.id, scope);

  revalidatePath(`/companies/${companyId}`);
  revalidatePath(`/documents/${documentId}`);
}

export async function addAttachmentAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const documentId = text(formData, "documentId");
  if (!documentId) return { error: "Missing document" };

  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "Choose a file to upload" };

  try {
    const user = await requireDocumentEditor();
    const scope = await getCompanyScope(user);
    await addAttachment(documentId, file, user.id, scope);
  } catch (err) {
    return toFormState(err);
  }

  revalidatePath(`/documents/${documentId}`);
  return { ok: true };
}

export async function removeAttachmentAction(formData: FormData): Promise<void> {
  const attachmentId = text(formData, "attachmentId");
  if (!attachmentId) return;

  const user = await requireDocumentEditor();
    const scope = await getCompanyScope(user);
  const { documentId } = await removeAttachment(attachmentId, user.id, scope);

  revalidatePath(`/documents/${documentId}`);
}
