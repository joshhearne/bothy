"use server";

import { revalidatePath } from "next/cache";
import { checkbox, text, type FormState } from "@/lib/form";
import { ForbiddenError, getCompanyScope, requireDocumentEditor } from "@/server/auth/session";
import { NotFoundError } from "@/server/services/errors";
import {
  applyDomainSuggestion,
  NoDomainFieldError,
  NotADomainError,
  runDomainCheck,
  setDomainChecks,
  SuggestionRejectedError,
  TooManyChecksError,
  type DomainRole,
} from "@/server/services/domain-checks";

function toFormState(err: unknown): FormState {
  if (err instanceof ForbiddenError) return { error: err.message };
  if (err instanceof NotFoundError) return { error: err.message };
  if (err instanceof NoDomainFieldError) return { error: err.message };
  if (err instanceof NotADomainError) return { error: err.message };
  if (err instanceof TooManyChecksError) return { error: err.message };
  if (err instanceof SuggestionRejectedError) return { error: err.message };
  throw err;
}

/** Choosing which lookups this record runs. Saved without running anything. */
export async function saveDomainChecksAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const documentId = text(formData, "documentId");
  if (!documentId) return { error: "Missing document" };

  try {
    const user = await requireDocumentEditor();
    await setDomainChecks(
      documentId,
      {
        dns: checkbox(formData, "dns"),
        tls: checkbox(formData, "tls"),
        rdap: checkbox(formData, "rdap"),
        email: checkbox(formData, "email"),
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

/** Runs them now. Outbound traffic, so it needs someone who may edit. */
export async function runDomainCheckAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const documentId = text(formData, "documentId");
  if (!documentId) return { error: "Missing document" };

  try {
    const user = await requireDocumentEditor();
    await runDomainCheck(documentId, user.id, await getCompanyScope(user));
  } catch (err) {
    return toFormState(err);
  }

  revalidatePath(`/documents/${documentId}`);
  return { ok: true };
}

/** Writes one finding into the record, as an ordinary edit. */
export async function applyDomainSuggestionAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const documentId = text(formData, "documentId");
  const role = text(formData, "role") as Exclude<DomainRole, "domain"> | undefined;
  const value = text(formData, "value");
  if (!documentId || !role || !value) return { error: "Missing suggestion" };

  try {
    const user = await requireDocumentEditor();
    await applyDomainSuggestion(documentId, role, value, user.id, await getCompanyScope(user));
  } catch (err) {
    return toFormState(err);
  }

  revalidatePath(`/documents/${documentId}`);
  return { ok: true };
}
