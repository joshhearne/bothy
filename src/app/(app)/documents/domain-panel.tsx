"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/alert";
import { useLocale, useMessages } from "@/i18n/client";
import { formatDateTime } from "@/i18n/format";
import type { FormState } from "@/lib/form";
import type { DomainCheckState } from "@/server/services/domain-checks";
import type { Finding, Severity } from "@/server/domain/parse";
import {
  applyDomainSuggestionAction,
  runDomainCheckAction,
  saveDomainChecksAction,
} from "./domain-actions";

const DOT: Record<Severity, string> = {
  ok: "bg-[color-mix(in_oklab,var(--primary)_70%,transparent)]",
  warn: "bg-[oklch(0.76_0.15_75)]",
  bad: "bg-[var(--destructive)]",
};

function FindingList({ findings }: { findings: Finding[] }) {
  return (
    <ul className="flex flex-col gap-1">
      {findings.map((finding, index) => (
        <li key={index} className="flex items-start gap-2 text-sm">
          <span
            aria-hidden
            className={`mt-1.5 size-2 shrink-0 rounded-full ${DOT[finding.severity]}`}
          />
          <span>{finding.message}</span>
        </li>
      ))}
    </ul>
  );
}

function Section({
  title,
  section,
  children,
}: {
  title: string;
  section: { ok: boolean; error?: string; findings?: Finding[] } | undefined;
  children?: React.ReactNode;
}) {
  if (!section) return null;

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <h4 className="text-sm font-medium">{title}</h4>
      {section.ok ? (
        <>
          <FindingList findings={section.findings ?? []} />
          {children}
        </>
      ) : (
        <p className="text-sm text-[var(--muted-foreground)]">{section.error}</p>
      )}
    </div>
  );
}

function Suggestion({
  documentId,
  role,
  label,
  value,
  current,
}: {
  documentId: string;
  role: "expiry" | "registrar" | "dns_host";
  label: string;
  value: string;
  current: string | null;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(
    applyDomainSuggestionAction,
    {},
  );
  const t = useMessages();

  // Already what the record says: report agreement rather than offer a change.
  if (current && current.toLowerCase() === value.toLowerCase()) {
    return (
      <p className="text-sm text-[var(--muted-foreground)]">
        {label}: {value} — {t.documents.domain.matches}
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2 text-sm">
      <input type="hidden" name="documentId" value={documentId} />
      <input type="hidden" name="role" value={role} />
      <input type="hidden" name="value" value={value} />
      <span>{t.documents.domain.suggests(label, value)}</span>
      <Button type="submit" variant="outline" size="sm">
        {t.documents.domain.use}
      </Button>
      {state.error && <span className="text-[var(--destructive)]">{state.error}</span>}
    </form>
  );
}

function RunButton({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? busy : label}
    </Button>
  );
}

/**
 * The checks a domain record runs, and what the last run found. Nothing is
 * looked up while a page is being read: a result is fetched when somebody asks
 * for it and kept until they ask again.
 */
export function DomainPanel({
  documentId,
  state,
  editor,
  current,
  checkedAt,
}: {
  documentId: string;
  state: DomainCheckState;
  editor: boolean;
  /** What the record already says, for comparing a suggestion against. */
  current: { expiry: string | null; registrar: string | null; dnsHost: string | null };
  /** ISO, because a Date crosses the boundary as a string anyway. */
  checkedAt: string | null;
}) {
  const t = useMessages();
  const locale = useLocale();
  const [saveState, saveAction] = useActionState<FormState, FormData>(saveDomainChecksAction, {});
  const [runState, runAction] = useActionState<FormState, FormData>(runDomainCheckAction, {});

  const result = state.result;
  const boxes = [
    { name: "dns", label: t.documents.domain.dns, hint: t.documents.domain.dnsHint, on: state.selection.dns },
    { name: "tls", label: t.documents.domain.tls, hint: t.documents.domain.tlsHint, on: state.selection.tls },
    { name: "rdap", label: t.documents.domain.rdap, hint: t.documents.domain.rdapHint, on: state.selection.rdap },
    { name: "email", label: t.documents.domain.email, hint: t.documents.domain.emailHint, on: state.selection.email },
  ];

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h3 className="text-lg font-semibold tracking-tight">{t.documents.domain.heading}</h3>
        <p className="text-sm text-[var(--muted-foreground)]">{t.documents.domain.subtitle}</p>
      </div>

      {editor && (
        <form action={saveAction} className="flex flex-col gap-3 rounded-md border p-4">
          <FormError>{saveState.error}</FormError>
          <input type="hidden" name="documentId" value={documentId} />

          <fieldset className="grid gap-3 sm:grid-cols-2">
            {boxes.map((box) => (
              <label key={box.name} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  name={box.name}
                  defaultChecked={box.on}
                  className="mt-0.5 size-4 rounded border"
                />
                <span>
                  <span className="font-medium">{box.label}</span>
                  <span className="block text-xs text-[var(--muted-foreground)]">{box.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <div>
            <Button type="submit" variant="outline" size="sm">
              {t.documents.domain.save}
            </Button>
          </div>
        </form>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {editor && state.domain && (
          <form action={runAction}>
            <input type="hidden" name="documentId" value={documentId} />
            <RunButton label={t.documents.domain.run} busy={t.documents.domain.running} />
          </form>
        )}

        <p className="text-sm text-[var(--muted-foreground)]">
          {checkedAt
            ? t.documents.domain.lastChecked(formatDateTime(new Date(checkedAt), locale))
            : t.documents.domain.never}
        </p>
      </div>

      <FormError>{runState.error}</FormError>

      {!state.targets.domain && (
        <p className="text-sm text-[var(--muted-foreground)]">{t.documents.domain.noField}</p>
      )}
      {state.targets.domain && !state.rawDomain && (
        <p className="text-sm text-[var(--muted-foreground)]">{t.documents.domain.noDomain}</p>
      )}
      {state.rawDomain && !state.domain && (
        <p className="text-sm text-[var(--destructive)]">
          {t.documents.domain.notADomain(state.rawDomain)}
        </p>
      )}

      {result && (
        <div className="flex flex-col gap-3">
          <Section title={t.documents.domain.dns} section={result.dns}>
            {result.dns?.ok && (
              <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 text-sm">
                {(
                  [
                    ["A", result.dns.data.a.join(", ")],
                    ["AAAA", result.dns.data.aaaa.join(", ")],
                    ["MX", result.dns.data.mx.map((mx) => `${mx.priority} ${mx.exchange}`).join(", ")],
                    ["NS", result.dns.data.ns.join(", ")],
                    ["TXT", result.dns.data.txt.join(" · ")],
                  ] as const
                )
                  .filter(([, value]) => value !== "")
                  .map(([name, value]) => (
                    <div key={name} className="contents">
                      <dt className="text-[var(--muted-foreground)]">{name}</dt>
                      <dd className="break-words font-mono text-xs">{value}</dd>
                    </div>
                  ))}
              </dl>
            )}

            {editor && result.dns?.ok && result.dns.data.ns[0] && state.targets.dns_host && (
              <Suggestion
                documentId={documentId}
                role="dns_host"
                label={t.documents.domain.dnsHost}
                // "dara.ns.cloudflare.com" is answered by Cloudflare.
                value={nameServerBrand(result.dns.data.ns[0])}
                current={current.dnsHost}
              />
            )}
          </Section>

          <Section title={t.documents.domain.tls} section={result.tls}>
            {result.tls?.ok && (
              <p className="text-sm text-[var(--muted-foreground)]">
                {result.tls.data.issuer} · {result.tls.data.names.join(", ")}
              </p>
            )}
          </Section>

          <Section title={t.documents.domain.rdap} section={result.rdap}>
            {editor && result.rdap?.ok && (
              <div className="flex flex-col gap-2">
                {result.rdap.data.registrar && state.targets.registrar && (
                  <Suggestion
                    documentId={documentId}
                    role="registrar"
                    label={t.documents.domain.registrar}
                    value={result.rdap.data.registrar}
                    current={current.registrar}
                  />
                )}
                {result.rdap.data.expires && state.targets.expiry && (
                  <Suggestion
                    documentId={documentId}
                    role="expiry"
                    label={t.documents.domain.expiry}
                    value={result.rdap.data.expires.slice(0, 10)}
                    current={current.expiry}
                  />
                )}
              </div>
            )}
          </Section>

          <Section title={t.documents.domain.email} section={result.email} />
        </div>
      )}
    </section>
  );
}

/** "dara.ns.cloudflare.com" names Cloudflare; the registrable part is the answer. */
function nameServerBrand(host: string): string {
  const labels = host.replace(/\.$/, "").split(".");
  const name = labels.length >= 2 ? labels[labels.length - 2] : labels[0];
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : host;
}
