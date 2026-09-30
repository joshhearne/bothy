"use server";

import { headers } from "next/headers";
import { APIError } from "better-auth/api";
import { auth } from "@/lib/auth";
import type { FormState } from "@/lib/form";
import { getMessages } from "@/i18n/server";

/** Answers the same whether or not the address has an account: that is not the asker's to learn. */
export async function requestResetAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) return { ok: true };
  try {
    await auth.api.requestPasswordReset({
      body: { email, redirectTo: "/reset-password" },
      headers: await headers(),
    });
  } catch (error) {
    if (error instanceof APIError && error.status === 429) {
      return { error: (await getMessages()).signIn.rateLimited };
    }
    if (!(error instanceof APIError)) throw error;
  }
  return { ok: true };
}
