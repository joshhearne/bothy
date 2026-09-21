"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { checkbox, text, toFieldErrors, type FormState } from "@/lib/form";
import { ForbiddenError, getCompanyScope, requireDocumentEditor } from "@/server/auth/session";
import { NotFoundError } from "@/server/services/errors";
import { addMount, removeMount, saveRackSettings, setTypeColor } from "@/server/services/racks";

function toFormState(err: unknown): FormState {
  if (err instanceof ZodError) return { fieldErrors: toFieldErrors(err) };
  if (err instanceof ForbiddenError) return { error: err.message };
  if (err instanceof NotFoundError) return { error: err.message };
  throw err;
}

export async function saveRackAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const documentId = text(formData, "documentId");
  if (!documentId) return { error: "Missing document" };

  try {
    const user = await requireDocumentEditor();
    await saveRackSettings(
      documentId,
      {
        totalU: text(formData, "totalU") ?? "42",
        hasRear: checkbox(formData, "hasRear"),
        numbering: (text(formData, "numbering") ?? "bottom_up") as "bottom_up" | "top_down",
      },
      user.id,
      await getCompanyScope(user),
    );
  } catch (err) {
    return toFormState(err);
  }

  revalidatePath(`/documents/${documentId}`);
  return { ok: true };
}

export async function addMountAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const documentId = text(formData, "documentId");
  if (!documentId) return { error: "Missing document" };

  try {
    const user = await requireDocumentEditor();
    await addMount(
      documentId,
      {
        positionU: text(formData, "positionU") ?? "1",
        heightU: text(formData, "heightU") ?? "1",
        face: (text(formData, "face") ?? "front") as "front" | "rear" | "both",
        documentId: text(formData, "mountedId") ?? null,
        label: text(formData, "label") ?? null,
        docTypeId: text(formData, "docTypeId") ?? null,
      },
      user.id,
      await getCompanyScope(user),
    );
  } catch (err) {
    return toFormState(err);
  }

  revalidatePath(`/documents/${documentId}`);
  return { ok: true };
}

export async function removeMountAction(formData: FormData): Promise<void> {
  const mountId = text(formData, "mountId");
  const documentId = text(formData, "documentId");
  if (!mountId) return;

  const user = await requireDocumentEditor();
  await removeMount(mountId, user.id, await getCompanyScope(user));
  if (documentId) revalidatePath(`/documents/${documentId}`);
}

/** With a company, this client's override; without, the MSP default. */
export async function setTypeColorAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const docTypeId = text(formData, "docTypeId");
  const documentId = text(formData, "documentId");
  if (!docTypeId) return { error: "Missing type" };

  try {
    const user = await requireDocumentEditor();
    await setTypeColor(
      docTypeId,
      text(formData, "companyId") ?? null,
      text(formData, "color") ?? null,
      user.id,
      await getCompanyScope(user),
    );
  } catch (err) {
    return toFormState(err);
  }

  if (documentId) revalidatePath(`/documents/${documentId}`);
  return { ok: true };
}
