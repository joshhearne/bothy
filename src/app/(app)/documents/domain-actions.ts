"use server";

import { revalidatePath } from "next/cache";
import { checkbox, text, type FormState } from "@/lib/form";
import {
  ForbiddenError,
  getCompanyScope,
  requireDocumentEditor,
} from "@/server/auth/session";
import { NotFoundError } from "@/server/services/errors";
import {
  applyDomainSuggestion,
  renameDomainSuggestion,
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
      {
        auto: checkbox(formData, "auto"),
        // Empty means "follow the company and the instance"; anything else is this record's own.
        intervals: {
          dns: text(formData, "dnsIntervalDays"),
          tls: text(formData, "tlsIntervalDays"),
          rdap: text(formData, "rdapIntervalDays"),
          email: text(formData, "emailIntervalDays"),
        },
        tlsAutoRenews: checkbox(formData, "tlsAutoRenews"),
        tlsWarnDays: text(formData, "tlsWarnDays"),
        dkimSelectors: text(formData, "dkimSelectors") ?? null,
      },
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

/**
 * Writes one finding into the record, as an ordinary edit ("add": the name
 * becomes the record's value, joining the list if it is new), or gives the
 * option the record holds that name ("rename": the shared list changes, the
 * record keeps its id).
 */
export async function applyDomainSuggestionAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const documentId = text(formData, "documentId");
  const role = text(formData, "role") as
    Exclude<DomainRole, "domain"> | undefined;
  const value = text(formData, "value");
  const mode = text(formData, "mode") === "rename" ? "rename" : "add";
  if (!documentId || !role || !value) return { error: "Missing suggestion" };

  try {
    const user = await requireDocumentEditor();
    const scope = await getCompanyScope(user);
    if (mode === "rename")
      await renameDomainSuggestion(documentId, role, value, user.id, scope);
    else await applyDomainSuggestion(documentId, role, value, user.id, scope);
  } catch (err) {
    return toFormState(err);
  }

  revalidatePath(`/documents/${documentId}`);
  return { ok: true };
}
