"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { checkbox, text, toFieldErrors, type FormState } from "@/lib/form";
import { ForbiddenError, requireAdmin, requireWriter } from "@/server/auth/session";
import {
  archiveCompany,
  createCompany,
  NotFoundError,
  unarchiveCompany,
  updateCompany,
} from "@/server/services/companies";
import {
  archiveLocation,
  createLocation,
  unarchiveLocation,
  updateLocation,
} from "@/server/services/locations";

/** Turns service-level failures into something a form can render. */
function toFormState(err: unknown): FormState {
  if (err instanceof ZodError) return { fieldErrors: toFieldErrors(err) };
  if (err instanceof ForbiddenError) return { error: err.message };
  if (err instanceof NotFoundError) return { error: err.message };
  throw err;
}

export async function createCompanyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  let id: string;
  try {
    const user = await requireWriter();
    ({ id } = await createCompany(
      {
        name: text(formData, "name") ?? "",
        isInternal: checkbox(formData, "isInternal"),
        notes: text(formData, "notes") ?? null,
      },
      user.id,
    ));
  } catch (err) {
    return toFormState(err);
  }

  revalidatePath("/companies");
  redirect(`/companies/${id}`);
}

export async function updateCompanyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = text(formData, "id");
  if (!id) return { error: "Missing company" };

  try {
    const user = await requireWriter();
    await updateCompany(
      id,
      {
        name: text(formData, "name") ?? "",
        isInternal: checkbox(formData, "isInternal"),
        notes: text(formData, "notes") ?? null,
      },
      user.id,
    );
  } catch (err) {
    return toFormState(err);
  }

  revalidatePath("/companies");
  revalidatePath(`/companies/${id}`);
  redirect(`/companies/${id}`);
}

export async function archiveCompanyAction(formData: FormData): Promise<void> {
  const id = text(formData, "id");
  if (!id) return;

  const user = await requireAdmin();
  await archiveCompany(id, user.id);

  revalidatePath("/companies");
  revalidatePath(`/companies/${id}`);
  redirect("/companies");
}

export async function unarchiveCompanyAction(formData: FormData): Promise<void> {
  const id = text(formData, "id");
  if (!id) return;

  const user = await requireAdmin();
  await unarchiveCompany(id, user.id);

  revalidatePath("/companies");
  revalidatePath(`/companies/${id}`);
}

export async function createLocationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const companyId = text(formData, "companyId");
  if (!companyId) return { error: "Missing company" };

  try {
    const user = await requireWriter();
    await createLocation(
      companyId,
      { name: text(formData, "name") ?? "", address: text(formData, "address") ?? null },
      user.id,
    );
  } catch (err) {
    return toFormState(err);
  }

  revalidatePath(`/companies/${companyId}`);
  return { ok: true };
}

export async function updateLocationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = text(formData, "id");
  const companyId = text(formData, "companyId");
  if (!id || !companyId) return { error: "Missing location" };

  try {
    const user = await requireWriter();
    await updateLocation(
      id,
      { name: text(formData, "name") ?? "", address: text(formData, "address") ?? null },
      user.id,
    );
  } catch (err) {
    return toFormState(err);
  }

  revalidatePath(`/companies/${companyId}`);
  redirect(`/companies/${companyId}`);
}

export async function archiveLocationAction(formData: FormData): Promise<void> {
  const id = text(formData, "id");
  const companyId = text(formData, "companyId");
  if (!id || !companyId) return;

  const user = await requireAdmin();
  await archiveLocation(id, user.id);

  revalidatePath(`/companies/${companyId}`);
}

export async function unarchiveLocationAction(formData: FormData): Promise<void> {
  const id = text(formData, "id");
  const companyId = text(formData, "companyId");
  if (!id || !companyId) return;

  const user = await requireAdmin();
  await unarchiveLocation(id, user.id);

  revalidatePath(`/companies/${companyId}`);
}
