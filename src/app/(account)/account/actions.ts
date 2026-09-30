"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { text, toFieldErrors, type FormState } from "@/lib/form";
import { requireSession } from "@/server/auth/session";
import {
  changeOwnPassword,
  passwordProblem,
  WrongPasswordError,
} from "@/server/services/accounts";
import {
  beginPasskeyRegistration,
  beginTotpEnrollment,
  confirmTotpEnrollment,
  finishPasskeyRegistration,
  mfaStatus,
  NothingPendingError,
  PasskeyRefusedError,
  regenerateRecoveryCodes,
  removePasskey,
  removeTotp,
  renamePasskey,
  WrongCodeError,
  type TotpEnrollment,
} from "@/server/services/mfa";
import { getMessages } from "@/i18n/server";

/**
 * A person's own account. These run for somebody with a session whether or
 * not they have finished signing in, because finishing is what some of them
 * are for. Changing what is enrolled asks for the current password first
 * where it removes something, so a session left open cannot be used to
 * quietly turn the second step off.
 */

const PATH = "/account/security";

export type EnrollState = FormState & { enrollment?: TotpEnrollment; recoveryCodes?: string[] };

export async function changePasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireSession();
  const t = await getMessages();
  const next = String(formData.get("next") ?? "");
  if (next !== String(formData.get("confirm") ?? "")) {
    return { fieldErrors: { confirm: t.account.mismatch } };
  }
  try {
    await changeOwnPassword(user, { current: String(formData.get("current") ?? ""), next }, user.sessionToken);
  } catch (error) {
    if (error instanceof ZodError) return { fieldErrors: toFieldErrors(error) };
    if (error instanceof WrongPasswordError) return { fieldErrors: { current: t.password.wrongCurrent } };
    const problem = passwordProblem(error);
    if (problem) return { fieldErrors: { next: problem } };
    throw error;
  }
  revalidatePath("/account/password");
  if (formData.get("required") === "1") redirect("/");
  return { ok: true };
}

/* ---------- Authenticator app ---------- */

export async function startTotpAction(): Promise<EnrollState> {
  const user = await requireSession();
  return { enrollment: await beginTotpEnrollment(user) };
}

export async function confirmTotpAction(prev: EnrollState, formData: FormData): Promise<EnrollState> {
  const user = await requireSession();
  const t = await getMessages();
  try {
    const { recoveryCodes } = await confirmTotpEnrollment(user, text(formData, "code") ?? "");
    revalidatePath(PATH);
    return { ok: true, ...(recoveryCodes ? { recoveryCodes } : {}) };
  } catch (error) {
    if (error instanceof WrongCodeError) {
      return { ...prev, fieldErrors: { code: t.mfa.wrongCode } };
    }
    if (error instanceof NothingPendingError) return { error: t.mfa.expired };
    throw error;
  }
}

export async function removeTotpAction(): Promise<void> {
  const user = await requireSession();
  const status = await mfaStatus(user.id);
  // An administrator keeps at least one; the page says so and hides the button.
  if (user.role === "admin" && status.passkeys.length === 0) return;
  await removeTotp(user);
  revalidatePath(PATH);
}

/* ---------- Passkeys ---------- */

export async function passkeyOptionsAction() {
  const user = await requireSession();
  return beginPasskeyRegistration(user);
}

export async function addPasskeyAction(
  response: RegistrationResponseJSON,
  label: string,
): Promise<{ ok: true; recoveryCodes: string[] | null } | { ok: false; error: string }> {
  const user = await requireSession();
  const t = await getMessages();
  try {
    const { recoveryCodes } = await finishPasskeyRegistration(user, response, label);
    revalidatePath(PATH);
    return { ok: true, recoveryCodes };
  } catch (error) {
    if (error instanceof PasskeyRefusedError) return { ok: false, error: t.account.passkeyFailed };
    if (error instanceof NothingPendingError) return { ok: false, error: t.mfa.expired };
    throw error;
  }
}

export async function renamePasskeyAction(formData: FormData): Promise<void> {
  const user = await requireSession();
  const id = text(formData, "id");
  if (!id) return;
  await renamePasskey(user, id, text(formData, "label") ?? "");
  revalidatePath(PATH);
}

export async function removePasskeyAction(formData: FormData): Promise<void> {
  const user = await requireSession();
  const id = text(formData, "id");
  if (!id) return;
  const status = await mfaStatus(user.id);
  if (user.role === "admin" && !status.totp && status.passkeys.length <= 1) return;
  await removePasskey(user, id);
  revalidatePath(PATH);
}

/* ---------- Recovery codes ---------- */

export async function regenerateRecoveryAction(): Promise<{ recoveryCodes: string[] }> {
  const user = await requireSession();
  const codes = await regenerateRecoveryCodes(user);
  revalidatePath(PATH);
  return { recoveryCodes: codes };
}
