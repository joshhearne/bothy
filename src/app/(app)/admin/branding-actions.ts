"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { text, toFieldErrors, type FormState } from "@/lib/form";
import { ForbiddenError, getCompanyScope, requireAdmin } from "@/server/auth/session";
import { NotFoundError } from "@/server/services/errors";
import {
  clearCompanyLogo,
  clearInstanceLogo,
  LogoTooLargeError,
  setCompanyBranding,
  setCompanyLogo,
  setInstanceBranding,
  setInstanceLogo,
  UnsupportedLogoError,
} from "@/server/services/branding";

function toFormState(err: unknown): FormState {
  if (err instanceof ZodError) return { fieldErrors: toFieldErrors(err) };
  if (err instanceof UnsupportedLogoError) return { fieldErrors: { logo: err.message } };
  if (err instanceof LogoTooLargeError) return { fieldErrors: { logo: err.message } };
  if (err instanceof ForbiddenError) return { error: err.message };
  if (err instanceof NotFoundError) return { error: err.message };
  throw err;
}

/** Branding is instance-wide configuration, so it sits with the other admin screens. */
export async function saveBrandingAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await requireAdmin();
    await setInstanceBranding(
      {
        name: text(formData, "name") ?? null,
        scheme: text(formData, "scheme") === "dark" ? "dark" : "light",
        accent: text(formData, "accent") ?? null,
        altAccent: text(formData, "altAccent") ?? null,
      },
      user.id,
    );
  } catch (err) {
    return toFormState(err);
  }

  // The name and logo ride in the shell and the tab title, so every page changes.
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function uploadLogoAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) {
    return { fieldErrors: { logo: "Choose an image to upload" } };
  }

  const slot = text(formData, "slot") === "alt" ? "alt" : "primary";

  try {
    const user = await requireAdmin();
    await setInstanceLogo(file, user.id, slot);
  } catch (err) {
    return toFormState(err);
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removeLogoAction(formData: FormData): Promise<void> {
  const slot = text(formData, "slot") === "alt" ? "alt" : "primary";
  const user = await requireAdmin();
  await clearInstanceLogo(user.id, slot);
  revalidatePath("/", "layout");
}

/* ---------- Per company ---------- */

export async function saveCompanyBrandingAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const companyId = text(formData, "companyId");
  if (!companyId) return { error: "Missing company" };

  const file = formData.get("logo");
  const altFile = formData.get("altLogo");

  try {
    const user = await requireAdmin();
    const scope = await getCompanyScope(user);

    await setCompanyBranding(
      companyId,
      {
        scheme: text(formData, "scheme") ?? "light",
        accent: text(formData, "accent") ?? null,
        altAccent: text(formData, "altAccent") ?? null,
      },
      user.id,
      scope,
    );

    if (file instanceof File && file.size > 0) {
      await setCompanyLogo(companyId, file, user.id, scope, "primary");
    }
    if (altFile instanceof File && altFile.size > 0) {
      await setCompanyLogo(companyId, altFile, user.id, scope, "alt");
    }
  } catch (err) {
    return toFormState(err);
  }

  revalidatePath(`/companies/${companyId}`);
  return { ok: true };
}

export async function removeCompanyLogoAction(formData: FormData): Promise<void> {
  const companyId = text(formData, "companyId");
  if (!companyId) return;

  const slot = text(formData, "slot") === "alt" ? "alt" : "primary";
  const user = await requireAdmin();
  await clearCompanyLogo(companyId, user.id, await getCompanyScope(user), slot);
  revalidatePath(`/companies/${companyId}`);
}
