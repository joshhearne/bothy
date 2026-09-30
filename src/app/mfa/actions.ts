"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Route } from "next";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { text } from "@/lib/form";
import { requireSession } from "@/server/auth/session";
import {
  beginPasskeyAuthentication,
  NothingPendingError,
  SecondStepLockedError,
  verifyPasskeyStep,
  verifyRecoveryCodeStep,
  verifyTotpStep,
  WrongCodeError,
} from "@/server/services/mfa";
import { formatDateTime } from "@/i18n/format";
import { getI18n } from "@/i18n/server";

/**
 * The second step. Each way of passing it ends the same: the session is
 * marked verified and the person goes where they were going.
 */

export type MfaState = { error?: string; left?: number };

/** Only a path on this site; a full address would be an open redirect. */
function safeNext(value: string | undefined): Route {
  return (value && value.startsWith("/") && !value.startsWith("//") ? value : "/") as Route;
}

async function address(): Promise<string | null> {
  const list = await headers();
  return list.get("x-forwarded-for")?.split(",")[0]?.trim() || list.get("x-real-ip") || null;
}

async function said(error: unknown): Promise<MfaState> {
  const { locale, messages: t } = await getI18n();
  if (error instanceof WrongCodeError) return { error: t.mfa.wrongCode };
  if (error instanceof SecondStepLockedError) {
    return { error: t.mfa.locked(formatDateTime(error.until, locale)) };
  }
  if (error instanceof NothingPendingError) return { error: t.mfa.expired };
  throw error;
}

export async function verifyCodeAction(_prev: MfaState, formData: FormData): Promise<MfaState> {
  const user = await requireSession();
  const next = safeNext(text(formData, "next"));
  const code = text(formData, "code") ?? "";
  const recovery = formData.get("method") === "recovery";

  try {
    if (recovery) {
      const { left } = await verifyRecoveryCodeStep(user.id, code, user.sessionToken, await address());
      if (left <= 2) redirect(`/account/security?left=${left}` as Route);
    } else {
      await verifyTotpStep(user.id, code, user.sessionToken, await address());
    }
  } catch (error) {
    return said(error);
  }
  redirect(next);
}

export async function passkeyChallengeAction() {
  const user = await requireSession();
  return beginPasskeyAuthentication(user.id);
}

export async function verifyPasskeyAction(
  response: AuthenticationResponseJSON,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireSession();
  try {
    await verifyPasskeyStep(user.id, response, user.sessionToken, await address());
    return { ok: true };
  } catch (error) {
    const state = await said(error);
    return { ok: false, error: state.error ?? "" };
  }
}
