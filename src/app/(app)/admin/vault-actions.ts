"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { checkbox, text, toFieldErrors, type FormState } from "@/lib/form";
import { ForbiddenError, requireAdmin, type Role } from "@/server/auth/session";
import { NotFoundError } from "@/server/services/companies";
import {
  createVaultProvider,
  updateVaultProvider,
  BITWARDEN_SYSTEM,
} from "@/server/services/vault";
import { removeExternalRef, upsertExternalRef } from "@/server/services/external-refs";
import { setCanRevealSecrets, setUserRole } from "@/server/services/users";

function toFormState(err: unknown): FormState {
  if (err instanceof ZodError) return { fieldErrors: toFieldErrors(err) };
  if (err instanceof ForbiddenError) return { error: err.message };
  if (err instanceof NotFoundError) return { error: err.message };
  throw err;
}

function providerInput(formData: FormData) {
  return {
    name: text(formData, "name") ?? "",
    kind: (text(formData, "kind") ?? "link") as "link" | "bw_serve",
    webVaultUrl: text(formData, "webVaultUrl") ?? null,
    organizationId: text(formData, "organizationId") ?? null,
    allowCreate: checkbox(formData, "allowCreate"),
    enabled: checkbox(formData, "enabled"),
  };
}

export async function saveVaultProviderAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = text(formData, "id");

  try {
    const user = await requireAdmin();
    if (id) await updateVaultProvider(id, providerInput(formData), user.id);
    else await createVaultProvider(providerInput(formData), user.id);
  } catch (err) {
    return toFormState(err);
  }

  revalidatePath("/admin/vault");
  return { ok: true };
}

export async function mapCollectionAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const companyId = text(formData, "companyId");
  const collectionId = text(formData, "collectionId");
  if (!companyId || !collectionId) return { error: "Choose a company and a collection id" };

  try {
    const user = await requireAdmin();
    await upsertExternalRef(
      {
        entity: "company",
        entity_id: companyId,
        system: BITWARDEN_SYSTEM,
        external_id: collectionId,
      },
      user.id,
    );
  } catch (err) {
    return toFormState(err);
  }

  revalidatePath("/admin/vault");
  return { ok: true };
}

export async function unmapCollectionAction(formData: FormData): Promise<void> {
  const id = text(formData, "id");
  if (!id) return;
  const user = await requireAdmin();
  await removeExternalRef(id, user.id);
  revalidatePath("/admin/vault");
}

export async function setUserRoleAction(formData: FormData): Promise<void> {
  const id = text(formData, "id");
  const role = text(formData, "role") as Role | undefined;
  if (!id || !role) return;

  const user = await requireAdmin();
  await setUserRole(id, role, user.id);
  revalidatePath("/admin/users");
}

export async function setCanRevealAction(formData: FormData): Promise<void> {
  const id = text(formData, "id");
  if (!id) return;

  const user = await requireAdmin();
  await setCanRevealSecrets(id, checkbox(formData, "canReveal"), user.id);
  revalidatePath("/admin/users");
}
