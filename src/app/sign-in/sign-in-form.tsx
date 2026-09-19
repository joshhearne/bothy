"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/ui/alert";
import { signInAction, type SignInState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Signing in…" : "Sign in"}
    </Button>
  );
}

/**
 * Starts the generic OAuth flow. The plugin answers with the provider's
 * authorization URL, which the browser then follows.
 */
async function startSso() {
  const response = await fetch("/api/auth/sign-in/oauth2", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ providerId: "oidc", callbackURL: "/companies" }),
  });

  const data = (await response.json()) as { url?: string };
  if (data.url) window.location.href = data.url;
}

export function SignInForm({ ssoEnabled = false }: { ssoEnabled?: boolean }) {
  const [state, formAction] = useActionState<SignInState, FormData>(signInAction, {});

  return (
    <div className="flex flex-col gap-4">
      {ssoEnabled && (
        <>
          <Button type="button" variant="outline" className="w-full" onClick={startSso}>
            Sign in with SSO
          </Button>
          <div className="flex items-center gap-3 text-xs text-[var(--muted-foreground)]">
            <span className="h-px flex-1 bg-[var(--border)]" />
            or use a local account
            <span className="h-px flex-1 bg-[var(--border)]" />
          </div>
        </>
      )}

      <form action={formAction} className="flex flex-col gap-4">
      <FormError>{state.error}</FormError>

      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="username" required />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>

        <SubmitButton />
      </form>
    </div>
  );
}
