"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { text, toFieldErrors, type FormState } from "@/lib/form";
import { ForbiddenError, getCompanyScope, requireDocumentEditor } from "@/server/auth/session";
import { NotFoundError } from "@/server/services/errors";
import { clearSchedule, markDone, setSchedule } from "@/server/services/schedules";

function toFormState(err: unknown): FormState {
  if (err instanceof ZodError) return { fieldErrors: toFieldErrors(err) };
  if (err instanceof ForbiddenError) return { error: err.message };
  if (err instanceof NotFoundError) return { error: err.message };
  throw err;
}

export async function saveScheduleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const documentId = text(formData, "documentId");
  if (!documentId) return { error: "Missing document" };

  try {
    const user = await requireDocumentEditor();
    await setSchedule(
      documentId,
      {
        kind: (text(formData, "kind") ?? "expiry") as "expiry" | "maintenance",
        dueOn: text(formData, "dueOn") ?? "",
        intervalDays: text(formData, "intervalDays") ?? null,
        leadDays: text(formData, "leadDays") ?? "30",
        note: text(formData, "note") ?? null,
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

export async function clearScheduleAction(formData: FormData): Promise<void> {
  const documentId = text(formData, "documentId");
  if (!documentId) return;

  const user = await requireDocumentEditor();
  await clearSchedule(documentId, user.id, await getCompanyScope(user));
  revalidatePath(`/documents/${documentId}`);
}

export async function markDoneAction(formData: FormData): Promise<void> {
  const documentId = text(formData, "documentId");
  if (!documentId) return;

  const user = await requireDocumentEditor();
  await markDone(documentId, user.id, await getCompanyScope(user));
  revalidatePath(`/documents/${documentId}`);
  revalidatePath("/admin/notifications");
}
