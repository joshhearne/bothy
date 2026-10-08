"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { text, toFieldErrors, type FormState } from "@/lib/form";
import {
  ForbiddenError,
  requireAdmin,
  requireRecentMfa,
} from "@/server/auth/session";
import { NotFoundError } from "@/server/services/errors";
import { isPermission, type Permission } from "@/server/auth/permissions";
import {
  archiveRole,
  BuiltinRoleError,
  createRole,
  RoleInUseError,
  RoleTakenError,
  updateRole,
} from "@/server/services/roles";

function permissionsFrom(formData: FormData): Permission[] {
  return formData.getAll("permissions").map(String).filter(isPermission);
}

function toFormState(err: unknown): FormState {
  if (err instanceof ZodError) return { fieldErrors: toFieldErrors(err) };
  if (
    err instanceof ForbiddenError ||
    err instanceof NotFoundError ||
    err instanceof RoleTakenError ||
    err instanceof RoleInUseError ||
    err instanceof BuiltinRoleError
  ) {
    return { error: err.message };
  }
  throw err;
}

/** Roles decide what people may do, so changing them asks for the second step again. */
async function administrator() {
  const user = await requireAdmin();
  await requireRecentMfa(user);
  return user;
}

export async function createRoleAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await administrator();
    await createRole(
      {
        name: text(formData, "name") ?? "",
        key: text(formData, "key") ?? "",
        description: text(formData, "description") ?? null,
        permissions: permissionsFrom(formData),
      },
      user.id,
    );
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath("/admin/roles");
  revalidatePath("/admin/users");
  return { ok: true };
}

export async function updateRoleAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const key = text(formData, "key");
  if (!key) return { error: "Missing role" };
  try {
    const user = await administrator();
    await updateRole(
      key,
      {
        name: text(formData, "name") ?? "",
        description: text(formData, "description") ?? null,
        permissions: permissionsFrom(formData),
      },
      user.id,
    );
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath("/admin/roles");
  revalidatePath("/admin/users");
  return { ok: true };
}

export async function archiveRoleAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const key = text(formData, "key");
  if (!key) return { error: "Missing role" };
  try {
    const user = await administrator();
    await archiveRole(key, user.id);
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath("/admin/roles");
  revalidatePath("/admin/users");
  return { ok: true };
}
