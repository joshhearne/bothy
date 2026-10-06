"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { checkbox, text, toFieldErrors, type FormState } from "@/lib/form";
import { ForbiddenError, requireAdmin } from "@/server/auth/session";
import { NotFoundError } from "@/server/services/errors";
import {
  createCollection,
  DuplicateCollectionError,
  setCollectionArchived,
  updateCollection,
} from "@/server/services/kb";
import { setGrant } from "@/server/services/kb-grants";
import {
  archiveConnector,
  createConnector,
  runConnector,
  setConnectorEnabled,
} from "@/server/services/kb-connectors";

function toFormState(err: unknown): FormState {
  if (err instanceof ZodError) return { fieldErrors: toFieldErrors(err) };
  if (err instanceof DuplicateCollectionError) return { fieldErrors: { name: err.message } };
  if (err instanceof ForbiddenError) return { error: err.message };
  if (err instanceof NotFoundError) return { error: err.message };
  throw err;
}

function collectionInput(formData: FormData) {
  return {
    name: text(formData, "name") ?? "",
    description: text(formData, "description"),
    siteUrl: text(formData, "siteUrl") ?? "",
    mcpEnabled: checkbox(formData, "mcpEnabled"),
    publicAccess: checkbox(formData, "publicAccess"),
    companyIds: formData.getAll("companyIds").filter((v): v is string => typeof v === "string"),
  };
}

export async function createCollectionAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  let id: string;
  try {
    const user = await requireAdmin();
    id = await createCollection(collectionInput(formData), user.id);
  } catch (err) {
    return toFormState(err);
  }

  revalidatePath("/admin/kb");
  redirect(`/admin/kb/${id}`);
}

export async function updateCollectionAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = text(formData, "id");
  if (!id) return { error: "Collection not found" };

  try {
    const user = await requireAdmin();
    await updateCollection(id, collectionInput(formData), user.id);
  } catch (err) {
    return toFormState(err);
  }

  revalidatePath("/admin/kb");
  revalidatePath(`/admin/kb/${id}`);
  return { ok: true };
}

export async function setCollectionArchivedAction(formData: FormData): Promise<void> {
  const id = text(formData, "id");
  if (!id) return;
  const user = await requireAdmin();
  await setCollectionArchived(id, checkbox(formData, "archived"), user.id);
  revalidatePath("/admin/kb");
  revalidatePath(`/admin/kb/${id}`);
}

export async function setGrantAction(formData: FormData): Promise<void> {
  const collectionId = text(formData, "collectionId");
  const apiKeyId = text(formData, "apiKeyId");
  if (!collectionId || !apiKeyId) return;

  const user = await requireAdmin();
  await setGrant(
    {
      collectionId,
      apiKeyId,
      level: (text(formData, "level") ?? "none") as "none" | "read" | "write",
    },
    user.id,
  );
  revalidatePath(`/admin/kb/${collectionId}`);
}

export async function createConnectorAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const collectionId = text(formData, "collectionId") ?? "";
  try {
    const user = await requireAdmin();
    await createConnector(
      {
        collectionId,
        kind: (text(formData, "kind") ?? "sitemap") as "sitemap" | "prefix",
        url: text(formData, "url") ?? "",
        intervalHours: text(formData, "intervalHours") ?? 168,
        maxPages: text(formData, "maxPages") ?? 500,
      },
      user.id,
    );
  } catch (err) {
    return toFormState(err);
  }

  revalidatePath(`/admin/kb/${collectionId}`);
  return { ok: true };
}

export async function setConnectorEnabledAction(formData: FormData): Promise<void> {
  const id = text(formData, "id");
  if (!id) return;
  const user = await requireAdmin();
  await setConnectorEnabled(id, checkbox(formData, "enabled"), user.id);
  revalidatePath(`/admin/kb/${text(formData, "collectionId") ?? ""}`);
}

export async function archiveConnectorAction(formData: FormData): Promise<void> {
  const id = text(formData, "id");
  if (!id) return;
  const user = await requireAdmin();
  await archiveConnector(id, user.id);
  revalidatePath(`/admin/kb/${text(formData, "collectionId") ?? ""}`);
}

/** Starts a run and returns: a crawl can take far longer than a request may. */
export async function runConnectorAction(formData: FormData): Promise<void> {
  const id = text(formData, "id");
  if (!id) return;
  const user = await requireAdmin();

  void runConnector(id, user.id).catch((error) => {
    console.error("bothy: knowledge base connector failed", error);
  });

  // Long enough for the run to have recorded itself before the page reloads.
  await new Promise((resolve) => setTimeout(resolve, 600));
  revalidatePath(`/admin/kb/${text(formData, "collectionId") ?? ""}`);
}
