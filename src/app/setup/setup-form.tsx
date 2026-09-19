"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/ui/alert";
import { createFirstAdminAction, type SetupState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Creating account…" : "Create admin account"}
    </Button>
  );
}

export function SetupForm({ minPasswordLength }: { minPasswordLength: number }) {
  const [state, formAction] = useActionState<SetupState, FormData>(createFirstAdminAction, {});
  const fieldErrors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <FormError>{state.error}</FormError>

      <div className="flex flex-col gap-2">
        <Label htmlFor="name">Your name</Label>
        <Input id="name" name="name" autoComplete="name" required aria-invalid={!!fieldErrors.name} />
        {fieldErrors.name && <p className="text-sm text-[var(--destructive)]">{fieldErrors.name}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          aria-invalid={!!fieldErrors.email}
        />
        {fieldErrors.email && <p className="text-sm text-[var(--destructive)]">{fieldErrors.email}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={minPasswordLength}
          required
          aria-invalid={!!fieldErrors.password}
        />
        <p className="text-xs text-[var(--muted-foreground)]">
          At least {minPasswordLength} characters.
        </p>
        {fieldErrors.password && (
          <p className="text-sm text-[var(--destructive)]">{fieldErrors.password}</p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="confirm">Confirm password</Label>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={!!fieldErrors.confirm}
        />
        {fieldErrors.confirm && (
          <p className="text-sm text-[var(--destructive)]">{fieldErrors.confirm}</p>
        )}
      </div>

      <SubmitButton />
    </form>
  );
}
