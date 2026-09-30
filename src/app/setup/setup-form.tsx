"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/ui/alert";
import { PasswordField, PasswordInput } from "@/components/password-field";
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

export function SetupForm() {
  const [state, formAction] = useActionState<SetupState, FormData>(createFirstAdminAction, {});
  const fieldErrors = state.fieldErrors ?? {};
  const t = useMessages();
  const [owner, setOwner] = useState<{ name: string; email: string }>({ name: "", email: "" });

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <FormError>{state.error}</FormError>

      <div className="flex flex-col gap-2">
        <Label htmlFor="name">{t.setup.yourName}</Label>
        <Input
          id="name"
          name="name"
          autoComplete="name"
          required
          aria-invalid={!!fieldErrors.name}
          onChange={(event) => setOwner((was) => ({ ...was, name: event.target.value }))}
        />
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
          onChange={(event) => setOwner((was) => ({ ...was, email: event.target.value }))}
        />
        {fieldErrors.email && <p className="text-sm text-[var(--destructive)]">{fieldErrors.email}</p>}
      </div>

      <PasswordField
        id="password"
        name="password"
        label={t.setup.password}
        owner={owner}
        error={fieldErrors.password}
      />

      <div className="flex flex-col gap-2">
        <Label htmlFor="confirm">{t.setup.confirmPassword}</Label>
        <PasswordInput id="confirm" name="confirm" autoComplete="new-password" />
        {fieldErrors.confirm && (
          <p className="text-sm text-[var(--destructive)]">{fieldErrors.confirm}</p>
        )}
      </div>

      <p className="text-xs text-[var(--muted-foreground)]">{t.setup.mfaNext}</p>

      <SubmitButton />
    </form>
  );
}
