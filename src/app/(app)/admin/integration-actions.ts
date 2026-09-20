"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { checkbox, text, toFieldErrors, type FormState } from "@/lib/form";
import { ForbiddenError, requireAdmin } from "@/server/auth/session";
import { NotFoundError } from "@/server/services/companies";
import { createApiKey, revokeApiKey } from "@/server/services/api-keys";
import {
  createWebhook,
  deleteWebhook,
  setWebhookActive,
  WEBHOOK_EVENTS,
} from "@/server/services/webhooks";

function toFormState(err: unknown): FormState {
  if (err instanceof ZodError) return { fieldErrors: toFieldErrors(err) };
  if (err instanceof ForbiddenError) return { error: err.message };
  if (err instanceof NotFoundError) return { error: err.message };
  throw err;
}

/** The generated key rides back in the form state: it is never stored. */
export type ApiKeyState = FormState & { secret?: string; prefix?: string };

export async function createApiKeyAction(
  _prev: ApiKeyState,
  formData: FormData,
): Promise<ApiKeyState> {
  try {
    const user = await requireAdmin();
    const scopes = formData.getAll("scopes").filter((v): v is string => typeof v === "string");
    const { row, key } = await createApiKey(
      {
        name: text(formData, "name") ?? "",
        scopes: scopes as ("read" | "write" | "admin")[],
        allCompanies: formData.get("allCompanies") === "all",
        companyIds: formData.getAll("companyIds").filter((v): v is string => typeof v === "string"),
      },
      user.id,
    );

    revalidatePath("/admin/api-keys");
    return { ok: true, secret: key, prefix: row.prefix };
  } catch (err) {
    return toFormState(err);
  }
}

export async function revokeApiKeyAction(formData: FormData): Promise<void> {
  const id = text(formData, "id");
  if (!id) return;
  const user = await requireAdmin();
  await revokeApiKey(id, user.id);
  revalidatePath("/admin/api-keys");
}

export type WebhookState = FormState & { secret?: string };

export async function createWebhookAction(
  _prev: WebhookState,
  formData: FormData,
): Promise<WebhookState> {
  try {
    const user = await requireAdmin();
    const events = formData
      .getAll("events")
      .filter((v): v is string => typeof v === "string")
      .filter((event) => (WEBHOOK_EVENTS as readonly string[]).includes(event));

    const { secret } = await createWebhook(
      {
        url: text(formData, "url") ?? "",
        events: events as (typeof WEBHOOK_EVENTS)[number][],
        active: true,
      },
      user.id,
    );

    revalidatePath("/admin/webhooks");
    return { ok: true, secret };
  } catch (err) {
    return toFormState(err);
  }
}

export async function setWebhookActiveAction(formData: FormData): Promise<void> {
  const id = text(formData, "id");
  if (!id) return;
  const user = await requireAdmin();
  await setWebhookActive(id, checkbox(formData, "active"), user.id);
  revalidatePath("/admin/webhooks");
}

export async function deleteWebhookAction(formData: FormData): Promise<void> {
  const id = text(formData, "id");
  if (!id) return;
  const user = await requireAdmin();
  await deleteWebhook(id, user.id);
  revalidatePath("/admin/webhooks");
}
