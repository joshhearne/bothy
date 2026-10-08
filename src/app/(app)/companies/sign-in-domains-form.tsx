"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import { useMessages } from "@/i18n/client";
import type { FormState } from "@/lib/form";
import { setSignInDomainsAction } from "./sign-in-domains-actions";

/** The email domains that place a visitor with this company, one per line. */
export function SignInDomainsForm({
  companyId,
  domains,
}: {
  companyId: string;
  domains: string[];
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    setSignInDomainsAction,
    {},
  );
  const t = useMessages();

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-4">
      <FormError>{state.error}</FormError>
      <input type="hidden" name="companyId" value={companyId} />

      <Field
        id="sign-in-domains"
        label={t.companies.signInDomains}
        hint={t.companies.signInDomainsHint}
        error={state.fieldErrors?.domains}
      >
        <Textarea
          id="sign-in-domains"
          name="domains"
          rows={3}
          defaultValue={domains.join("\n")}
          placeholder="example.com"
          className="font-mono text-sm"
        />
      </Field>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? t.common.saving : t.companies.signInDomainsSave}
        </Button>
        {state.ok && (
          <span
            role="status"
            className="text-sm text-[var(--muted-foreground)]"
          >
            {t.common.saved}
          </span>
        )}
      </div>
    </form>
  );
}
