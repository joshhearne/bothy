"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/ui/alert";
import { PasswordField, PasswordInput } from "@/components/password-field";
import { useMessages } from "@/i18n/client";
import type { FormState } from "@/lib/form";
import { resetPasswordAction } from "./actions";

export function ResetForm({ token, owner }: { token: string; owner: { email: string; name: string } }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(resetPasswordAction, {});
  const t = useMessages();
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <FormError>{state.error}</FormError>
      <PasswordField id="next" name="next" label={t.account.next} owner={owner} error={errors.next} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="confirm">{t.account.confirm}</Label>
        <PasswordInput id="confirm" name="confirm" autoComplete="new-password" />
        {errors.confirm && <p className="text-sm text-[var(--destructive)]">{errors.confirm}</p>}
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {t.signIn.resetSubmit}
      </Button>
    </form>
  );
}
