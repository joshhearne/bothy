"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { APIError } from "better-auth/api";
import { auth } from "@/lib/auth";
import {
  createFirstAdmin,
  firstAdminSchema,
  isSetupComplete,
  SetupAlreadyCompleteError,
} from "@/server/services/setup";

export type SetupState = { error?: string; fieldErrors?: Record<string, string> };

export async function createFirstAdminAction(
  _prev: SetupState,
  formData: FormData,
): Promise<SetupState> {
  if (await isSetupComplete()) redirect("/sign-in");

  const parsed = firstAdminSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { fieldErrors };
  }

  if (formData.get("confirm") !== parsed.data.password) {
    return { fieldErrors: { confirm: "Passwords do not match" } };
  }

  try {
    await createFirstAdmin(parsed.data);
  } catch (err) {
    if (err instanceof SetupAlreadyCompleteError) redirect("/sign-in");
    throw err;
  }

  try {
    await auth.api.signInEmail({
      body: { email: parsed.data.email, password: parsed.data.password },
      headers: await headers(),
    });
  } catch (err) {
    // The admin exists either way — send them to sign in rather than failing setup.
    if (err instanceof APIError) redirect("/sign-in");
    throw err;
  }

  redirect("/");
}
