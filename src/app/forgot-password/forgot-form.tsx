"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/ui/alert";
import { useMessages } from "@/i18n/client";
import type { FormState } from "@/lib/form";
import { requestResetAction } from "./actions";

export function ForgotForm() {
  const [state, formAction, pending] = useActionState<FormState, FormData>(requestResetAction, {});
  const t = useMessages();

  if (state.ok) return <p role="status" className="text-sm">{t.signIn.forgotSent}</p>;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <FormError>{state.error}</FormError>
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">{t.signIn.email}</Label>
        <Input id="email" name="email" type="email" autoComplete="username" required />
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {t.signIn.forgotSubmit}
      </Button>
    </form>
  );
}
