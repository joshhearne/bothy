"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/ui/alert";
import { useMessages } from "@/i18n/client";
import { createFirstAdminAction, type SetupState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  const t = useMessages();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? t.setup.submitting : t.setup.submit}
    </Button>
  );
}

export function SetupForm({ minPasswordLength }: { minPasswordLength: number }) {
  const [state, formAction] = useActionState<SetupState, FormData>(createFirstAdminAction, {});
  const fieldErrors = state.fieldErrors ?? {};
  const t = useMessages();

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <FormError>{state.error}</FormError>

      <div className="flex flex-col gap-2">
        <Label htmlFor="name">{t.setup.yourName}</Label>
        <Input id="name" name="name" autoComplete="name" required aria-invalid={!!fieldErrors.name} />
        {fieldErrors.name && <p className="text-sm text-[var(--destructive)]">{fieldErrors.name}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="email">{t.setup.email}</Label>
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
        <Label htmlFor="password">{t.setup.password}</Label>
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
          {t.setup.passwordHint(minPasswordLength)}
        </p>
        {fieldErrors.password && (
          <p className="text-sm text-[var(--destructive)]">{fieldErrors.password}</p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="confirm">{t.setup.confirmPassword}</Label>
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
