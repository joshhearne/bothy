"use server";

import { revalidatePath } from "next/cache";
import { text } from "@/lib/form";
import {
  requireUser,
  canEditDocuments,
  getCompanyScope,
  ForbiddenError,
} from "@/server/auth/session";
import { getDocumentDetail } from "@/server/services/documents";
import {
  createVaultItem,
  revealPassword,
  revealTotp,
  SecretPermissionError,
  SecretScopeError,
} from "@/server/services/vault";
import { VaultNotBrokeredError, VaultUnavailableError } from "@/server/vault/types";

/**
 * Reveal actions. The returned value is never revalidated into a cache, never
 * logged, and never stored; it goes straight back to the caller's screen.
 */

export type RevealResult =
  | { ok: true; value: string; periodRemaining?: number }
  | { ok: false; error: string };

function toError(err: unknown): RevealResult {
  if (err instanceof SecretPermissionError) return { ok: false, error: err.message };
  if (err instanceof SecretScopeError) return { ok: false, error: err.message };
  if (err instanceof VaultNotBrokeredError) return { ok: false, error: err.message };
  if (err instanceof VaultUnavailableError) return { ok: false, error: err.message };
  if (err instanceof ForbiddenError) return { ok: false, error: err.message };
  throw err;
}

export async function revealPasswordAction(
  documentId: string,
  fieldId: string,
  itemId: string,
): Promise<RevealResult> {
  try {
    const user = await requireUser();
    const scope = await getCompanyScope(user);
    const detail = await getDocumentDetail(documentId, scope);
    if (!detail) return { ok: false, error: "Document not found" };

    const value = await revealPassword({
      companyId: detail.document.companyId,
      documentId,
      fieldId,
      itemId,
      actor: { userId: user.id, canReveal: user.canRevealSecrets },
    });

    return { ok: true, value };
  } catch (err) {
    return toError(err);
  }
}

export async function revealTotpAction(
  documentId: string,
  fieldId: string,
  itemId: string,
): Promise<RevealResult> {
  try {
    const user = await requireUser();
    const scope = await getCompanyScope(user);
    const detail = await getDocumentDetail(documentId, scope);
    if (!detail) return { ok: false, error: "Document not found" };

    const totp = await revealTotp({
      companyId: detail.document.companyId,
      documentId,
      fieldId,
      itemId,
      actor: { userId: user.id, canReveal: user.canRevealSecrets },
    });

    return { ok: true, value: totp.code, periodRemaining: totp.period_remaining };
  } catch (err) {
    return toError(err);
  }
}

export type CreateSecretResult =
  | { ok: true; itemId: string; label: string }
  | { ok: false; error: string };

/** Creates a vault item from inside a document, when the provider allows it. */
export async function createVaultItemAction(
  documentId: string,
  input: { collectionId: string; name: string; username: string; uri: string; password: string },
): Promise<CreateSecretResult> {
  try {
    const user = await requireUser();
    if (!canEditDocuments(user.role)) throw new ForbiddenError();

    const scope = await getCompanyScope(user);
    const detail = await getDocumentDetail(documentId, scope);
    if (!detail) return { ok: false, error: "Document not found" };

    const ref = await createVaultItem({
      companyId: detail.document.companyId,
      collectionId: input.collectionId,
      name: input.name,
      username: input.username || undefined,
      uri: input.uri || undefined,
      password: input.password,
      actorId: user.id,
      scope,
    });

    revalidatePath(`/documents/${documentId}/edit`);
    return { ok: true, itemId: ref.item_id, label: ref.label };
  } catch (err) {
    const result = toError(err);
    return result.ok ? { ok: false, error: "Could not create that item" } : result;
  }
}

/** Server action wrapper used by plain forms. */
export async function noopAction(formData: FormData): Promise<void> {
  void text(formData, "id");
}
