"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { text, toFieldErrors, type FormState } from "@/lib/form";
import { ForbiddenError, requireDocumentEditor } from "@/server/auth/session";
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

function toFormState(err: unknown): FormState {
  if (err instanceof ZodError) return { fieldErrors: toFieldErrors(err) };
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
    const detail = await getDocumentDetail(documentId);
    if (!detail) return { error: "Document not found" };
    companyId = detail.document.companyId;

    const result = await saveDocument(
      documentId,
      { title: text(formData, "title") ?? "", values: readRawValues(formData, detail.fields) },
      user.id,
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
  await archiveDocument(documentId, user.id);

  revalidatePath(`/companies/${companyId}`);
  redirect(`/companies/${companyId}`);
}

export async function unarchiveDocumentAction(formData: FormData): Promise<void> {
  const documentId = text(formData, "documentId");
  const companyId = text(formData, "companyId");
  if (!documentId || !companyId) return;

  const user = await requireDocumentEditor();
  await unarchiveDocument(documentId, user.id);

  revalidatePath(`/companies/${companyId}`);
  revalidatePath(`/documents/${documentId}`);
}
