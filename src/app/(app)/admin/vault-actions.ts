"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { checkbox, text, toFieldErrors, type FormState } from "@/lib/form";
import {
  ForbiddenError,
  getCompanyScope,
  requireAdmin,
  type Role,
} from "@/server/auth/session";
import { NotFoundError } from "@/server/services/companies";
import {
  createVaultProvider,
  updateVaultProvider,
  mappingSystem,
  setCompanyVaultProvider,
} from "@/server/services/vault";
import { removeExternalRef, upsertExternalRef } from "@/server/services/external-refs";
import { setCanRevealSecrets, setUserCompanies, setUserRole } from "@/server/services/users";

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
  const providerId = text(formData, "providerId");
  if (!companyId || !collectionId || !providerId) {
    return { error: "Choose a company, a vault, and a collection id" };
  }

  try {
    const user = await requireAdmin();
    await upsertExternalRef(
      {
        entity: "company",
        entity_id: companyId,
        system: mappingSystem(providerId),
        external_id: collectionId,
      },
      user.id,
      await getCompanyScope(user),
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
  await removeExternalRef(id, user.id, await getCompanyScope(user));
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

/** Replaces one user's company grants from the admin screen. */
export async function setUserCompaniesAction(formData: FormData): Promise<void> {
  const id = text(formData, "id");
  if (!id) return;

  const user = await requireAdmin();
  await setUserCompanies(
    id,
    {
      allCompanies: formData.get("allCompanies") === "all",
      companyIds: formData.getAll("companyIds").filter((v): v is string => typeof v === "string"),
    },
    user.id,
  );

  revalidatePath("/admin/users");
}

/** Which vault a client's secrets live in. Empty means the instance default. */
export async function setCompanyVaultAction(formData: FormData): Promise<void> {
  const companyId = text(formData, "companyId");
  if (!companyId) return;

  const user = await requireAdmin();
  await setCompanyVaultProvider(
    companyId,
    text(formData, "providerId") ?? null,
    user.id,
    await getCompanyScope(user),
  );

  revalidatePath("/admin/vault");
}
