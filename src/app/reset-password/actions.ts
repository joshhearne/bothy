"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { APIError } from "better-auth/api";
import { auth } from "@/lib/auth";
import type { FormState } from "@/lib/form";
import { judgePassword, passwordProblem, resetOwner } from "@/server/services/accounts";
import { getMessages } from "@/i18n/server";

export async function resetPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const t = await getMessages();
  const token = String(formData.get("token") ?? "");
  const next = String(formData.get("next") ?? "");
  if (next !== String(formData.get("confirm") ?? "")) return { fieldErrors: { confirm: t.account.mismatch } };

  const owner = await resetOwner(token);
  if (!owner) return { error: t.signIn.resetExpired };

  try {
    await judgePassword(next, owner);
  } catch (error) {
    const problem = passwordProblem(error);
    if (problem) return { fieldErrors: { next: problem } };
    throw error;
  }

  try {
    await auth.api.resetPassword({ body: { newPassword: next, token }, headers: await headers() });
  } catch (error) {
    if (error instanceof APIError) return { error: t.signIn.resetExpired };
    throw error;
  }
  redirect("/sign-in?reset=1" as Route);
}
