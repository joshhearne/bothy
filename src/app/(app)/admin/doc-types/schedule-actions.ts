"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { text, toFieldErrors, type FormState } from "@/lib/form";
import { ForbiddenError, requireDocTypeManager } from "@/server/auth/session";
import {
  applyDocTypeScheduleToExisting,
  setDocTypeSchedule,
} from "@/server/services/schedules";

function toFormState(err: unknown): FormState {
  if (err instanceof ZodError) return { fieldErrors: toFieldErrors(err) };
  if (err instanceof ForbiddenError) return { error: err.message };
  throw err;
}

export async function saveDocTypeScheduleAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const docTypeId = text(formData, "docTypeId");
  if (!docTypeId) return { error: "Missing doc type" };

  try {
    const user = await requireDocTypeManager();
    await setDocTypeSchedule(
      docTypeId,
      {
        kind: (text(formData, "kind") ?? "none") as "none" | "expiry" | "maintenance",
        dueDays: text(formData, "dueDays") ?? null,
        intervalDays: text(formData, "intervalDays") ?? null,
        leadDays: text(formData, "leadDays") ?? "30",
      },
      user.id,
    );
  } catch (err) {
    return toFormState(err);
  }

  revalidatePath(`/admin/doc-types/${docTypeId}`);
  return { ok: true };
}

/** Stamps it into documents of this type that have no schedule of their own. */
export async function applyDocTypeScheduleAction(
  _prev: FormState & { stamped?: number },
  formData: FormData,
): Promise<FormState & { stamped?: number }> {
  const docTypeId = text(formData, "docTypeId");
  if (!docTypeId) return { error: "Missing doc type" };

  try {
    const user = await requireDocTypeManager();
    const stamped = await applyDocTypeScheduleToExisting(docTypeId, user.id);
    revalidatePath(`/admin/doc-types/${docTypeId}`);
    return { ok: true, stamped };
  } catch (err) {
    return toFormState(err);
  }
}
