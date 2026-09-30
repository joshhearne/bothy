"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { text, toFieldErrors, type FormState } from "@/lib/form";
import { ForbiddenError, requireAdmin, requireRecentMfa } from "@/server/auth/session";
import { NotFoundError } from "@/server/services/errors";
import {
  createLocalUser,
  DuplicateUserError,
  passwordProblem,
  setTemporaryPassword,
  unlockUser,
} from "@/server/services/accounts";
import { resetMfa } from "@/server/services/mfa";
import { getMessages } from "@/i18n/server";

/**
 * People and their credentials. Each of these is a sensitive action, so the
 * administrator's own second step must have been passed recently.
 */

const PATH = "/admin/users";

async function administrator() {
  const admin = await requireAdmin();
  await requireRecentMfa(admin);
  return admin;
}

export async function createUserAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const t = await getMessages();
  try {
    const admin = await administrator();
    await createLocalUser(
      {
        name: text(formData, "name") ?? "",
        email: text(formData, "email") ?? "",
        role: (text(formData, "role") ?? "tech") as "admin" | "tech" | "readonly",
        password: String(formData.get("password") ?? ""),
      },
      admin.id,
    );
  } catch (error) {
    if (error instanceof ZodError) return { fieldErrors: toFieldErrors(error) };
    if (error instanceof DuplicateUserError) return { fieldErrors: { email: t.admin.users.duplicate } };
    if (error instanceof ForbiddenError) return { error: error.message };
    const problem = passwordProblem(error);
    if (problem) return { fieldErrors: { password: problem } };
    throw error;
  }
  revalidatePath(PATH);
  return { ok: true };
}

export async function setTemporaryPasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const admin = await administrator();
    await setTemporaryPassword(
      { userId: text(formData, "id") ?? "", password: String(formData.get("password") ?? "") },
      admin.id,
    );
  } catch (error) {
    if (error instanceof ZodError) return { fieldErrors: toFieldErrors(error) };
    if (error instanceof ForbiddenError || error instanceof NotFoundError) return { error: error.message };
    const problem = passwordProblem(error);
    if (problem) return { fieldErrors: { password: problem } };
    throw error;
  }
  revalidatePath(PATH);
  return { ok: true };
}

export async function resetMfaAction(formData: FormData): Promise<void> {
  const admin = await administrator();
  const id = text(formData, "id");
  if (!id) return;
  await resetMfa(id, admin.id);
  revalidatePath(PATH);
}

export async function unlockUserAction(formData: FormData): Promise<void> {
  const admin = await administrator();
  const id = text(formData, "id");
  if (!id) return;
  await unlockUser(id, admin.id);
  revalidatePath(PATH);
}
