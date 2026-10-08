"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/alert";
import { Select } from "@/components/ui/select";
import { useMessages } from "@/i18n/client";
import type { FormState } from "@/lib/form";
import {
  INTERVAL_CHOICES,
  TLS_WARN_CHOICES,
  type CheckKind,
  type CheckPolicy,
  type PolicyOverrides,
} from "@/server/domain/policy";
import { setCompanyDomainPolicyAction } from "./domain-policy-actions";

const controlClass =
  "h-10 w-full rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

/**
 * A company's own timings for its domain records. Each choice may stay on the
 * instance default, which is shown with what that default is today.
 */
export function CompanyDomainPolicyForm({
  companyId,
  company,
  instance,
}: {
  companyId: string;
  company: PolicyOverrides;
  instance: CheckPolicy;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    setCompanyDomainPolicyAction,
    {},
  );
  const t = useMessages();
  const kinds: { kind: CheckKind; label: string }[] = [
    { kind: "dns", label: t.documents.domain.dns },
    { kind: "tls", label: t.documents.domain.tls },
    { kind: "rdap", label: t.documents.domain.rdap },
    { kind: "email", label: t.documents.domain.email },
  ];
  const describe = (days: number) =>
    days === 0 ? t.documents.domain.off : t.documents.domain.every(days);

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-4">
      <FormError>{state.error}</FormError>
      <input type="hidden" name="companyId" value={companyId} />

      <div className="grid gap-4 sm:grid-cols-2">
        {kinds.map(({ kind, label }) => {
          const own = company.intervals[kind] ?? null;
          return (
            <Field
              key={kind}
              id={`company-domain-${kind}`}
              label={label}
              error={state.fieldErrors?.[kind]}
            >
              <Select
                id={`company-domain-${kind}`}
                name={kind}
                defaultValue={own === null ? "" : String(own)}
                className={controlClass}
              >
                <option value="">
                  {t.documents.domain.instanceDefault(
                    describe(instance.intervals[kind]),
                  )}
                </option>
                {withCurrent([0, ...INTERVAL_CHOICES], own).map((value) => (
                  <option key={value} value={String(value)}>
                    {value === 0
                      ? t.admin.settings.domainIntervals.off
                      : value === 1
                        ? t.admin.settings.domainIntervals.day
                        : t.admin.settings.domainIntervals.days(value)}
                  </option>
                ))}
              </Select>
            </Field>
          );
        })}
      </div>

      <Field
        id="company-domain-tls-warn"
        label={t.admin.settings.domainTlsWarn}
        error={state.fieldErrors?.tlsWarnDays}
      >
        <Select
          id="company-domain-tls-warn"
          name="tlsWarnDays"
          defaultValue={
            company.tlsWarnDays == null ? "" : String(company.tlsWarnDays)
          }
          className={controlClass}
        >
          <option value="">
            {t.documents.domain.instanceDefault(
              t.admin.settings.domainTlsWarnDays(instance.tlsWarnDays),
            )}
          </option>
          {withCurrent([...TLS_WARN_CHOICES], company.tlsWarnDays ?? null).map(
            (value) => (
              <option key={value} value={String(value)}>
                {t.admin.settings.domainTlsWarnDays(value)}
              </option>
            ),
          )}
        </Select>
      </Field>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? t.common.saving : t.companies.domainChecksSave}
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

function withCurrent(choices: number[], current: number | null): number[] {
  if (current === null || choices.includes(current)) return choices;
  return [...choices, current].sort((a, b) => a - b);
}
