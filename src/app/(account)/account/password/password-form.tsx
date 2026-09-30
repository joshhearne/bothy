"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/ui/alert";
import { PasswordField, PasswordInput } from "@/components/password-field";
import { useMessages } from "@/i18n/client";
import type { FormState } from "@/lib/form";
import { changePasswordAction } from "../actions";

export function PasswordForm({
  owner,
  required,
}: {
  owner: { email: string; name: string };
  required: boolean;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(changePasswordAction, {});
  const t = useMessages();
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <FormError>{state.error}</FormError>
      {required && <input type="hidden" name="required" value="1" />}

      <div className="flex flex-col gap-2">
        <Label htmlFor="current">{t.account.current}</Label>
        <PasswordInput id="current" name="current" autoComplete="current-password" />
        {errors.current && <p className="text-sm text-[var(--destructive)]">{errors.current}</p>}
      </div>

      <PasswordField id="next" name="next" label={t.account.next} owner={owner} error={errors.next} />

      <div className="flex flex-col gap-2">
        <Label htmlFor="confirm">{t.account.confirm}</Label>
        <PasswordInput id="confirm" name="confirm" autoComplete="new-password" />
        {errors.confirm && <p className="text-sm text-[var(--destructive)]">{errors.confirm}</p>}
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? t.common.saving : t.account.changePassword}
        </Button>
        {state.ok && (
          <span role="status" className="text-sm text-[var(--muted-foreground)]">
            {t.account.passwordChanged}
          </span>
        )}
      </div>
    </form>
  );
}
