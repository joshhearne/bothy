"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { APIError } from "better-auth/api";
import { z } from "zod";
import { auth } from "@/lib/auth";

const signInSchema = z.object({
  email: z.email().max(320),
  password: z.string().min(1).max(128),
});

export type SignInState = { error?: string };

export async function signInAction(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  // Same message for bad input and bad credentials — no account enumeration.
  const INVALID = "Incorrect email or password";
  if (!parsed.success) return { error: INVALID };

  try {
    await auth.api.signInEmail({ body: parsed.data, headers: await headers() });
  } catch (err) {
    if (err instanceof APIError) {
      return { error: err.status === 429 ? "Too many attempts. Try again shortly." : INVALID };
    }
    throw err;
  }

  redirect("/");
}

export async function signOutAction(): Promise<void> {
  await auth.api.signOut({ headers: await headers() });
  redirect("/sign-in");
}
