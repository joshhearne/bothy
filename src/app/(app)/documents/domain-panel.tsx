"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/alert";
import { useLocale, useMessages } from "@/i18n/client";
import { formatDateTime } from "@/i18n/format";
import { Select } from "@/components/ui/select";
import type { FormState } from "@/lib/form";
import type { DomainCheckState } from "@/server/services/domain-checks";
import type { Finding, Severity } from "@/server/domain/parse";
import {
  activeKinds,
  INTERVAL_CHOICES,
  TLS_WARN_CHOICES,
  type CheckKind,
} from "@/server/domain/policy";
import { classifyTxt } from "@/server/domain/txt";
import { namesAgree } from "@/server/domain/names";
import { orderDns } from "@/server/domain/order";
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
  meta,
  hideFindings = false,
  children,
}: {
  title: string;
  section: { ok: boolean; error?: string; findings?: Finding[] } | undefined;
  /** "checked …", "next …": each section runs on its own clock. */
  meta?: string[];
  /** The children show the findings their own way (a table), so the list is not repeated. */
  hideFindings?: boolean;
  children?: React.ReactNode;
}) {
  if (!section) return null;

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h4 className="text-sm font-medium">{title}</h4>
        {meta && meta.length > 0 && (
          <span className="text-xs text-[var(--muted-foreground)]">
            {meta.join(" · ")}
          </span>
        )}
      </div>
      {section.ok ? (
        <>
          {!hideFindings && <FindingList findings={section.findings ?? []} />}
          {children}
        </>
      ) : (
        <p className="text-sm text-[var(--muted-foreground)]">
          {section.error}
        </p>
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
  option,
}: {
  documentId: string;
  role: "expiry" | "registrar" | "dns_host";
  label: string;
  value: string;
  current: string | null;
  /** The field is a dropdown, so a name can also rename the option it matched. */
  option: boolean;
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

  // The same name in different words ("Cloudflare, Inc." beside "Cloudflare"):
  // either becomes its own option, or the existing one takes the new name.
  const sameName = Boolean(current && option && namesAgree(current, value));

  return (
    <form
      action={formAction}
      className="flex flex-wrap items-center gap-2 text-sm"
    >
      <input type="hidden" name="documentId" value={documentId} />
      <input type="hidden" name="role" value={role} />
      <input type="hidden" name="value" value={value} />
      <span>
        {t.documents.domain.suggests(label, value)}
        {sameName && current && (
          <span className="ml-1 text-[var(--muted-foreground)]">
            {t.documents.domain.recordedAs(current)}
          </span>
        )}
      </span>
      <Button
        type="submit"
        name="mode"
        value="add"
        variant="outline"
        size="sm"
        title={
          sameName && current
            ? t.documents.domain.useHintOption(label, value, current)
            : t.documents.domain.useHint(label, value)
        }
      >
        {t.documents.domain.use}
      </Button>
      {sameName && current && (
        <Button
          type="submit"
          name="mode"
          value="rename"
          variant="outline"
          size="sm"
          title={t.documents.domain.updateHint(current, value)}
        >
          {t.documents.domain.update}
        </Button>
      )}
      {state.error && (
        <span className="text-[var(--destructive)]">{state.error}</span>
      )}
    </form>
  );
}

/**
 * Mail posture as a table: what was checked, what that means, and the record
 * itself. The findings arrive in the order SPF, DMARC, DKIM, which is the
 * order of the rows; a finding that is not there reads as a blank.
 */
function EmailTable({
  data,
  findings,
}: {
  data: {
    spf: string | null;
    dmarc: string | null;
    dmarcCname?: string | null;
    dkimSelectors: string[];
    dkimTried?: string[];
  };
  findings: Finding[];
}) {
  const t = useMessages();
  const none = (
    <span className="font-sans text-[var(--muted-foreground)]">
      {t.documents.domain.none}
    </span>
  );
  const rows: {
    name: string;
    finding: Finding | undefined;
    record: React.ReactNode;
  }[] = [
    {
      name: t.documents.domain.spfRecord,
      finding: findings[0],
      record: data.spf ?? none,
    },
    {
      name: t.documents.domain.dmarcRecord,
      finding: findings[1],
      record: (
        <>
          {data.dmarc ?? none}
          {data.dmarcCname && (
            <span className="ml-2 font-sans text-[var(--muted-foreground)]">
              {t.documents.domain.dmarcVia(data.dmarcCname)}
            </span>
          )}
        </>
      ),
    },
    {
      name: "DKIM",
      finding: findings[2],
      record: (
        <>
          {data.dkimSelectors.length > 0 ? data.dkimSelectors.join(", ") : none}
          {data.dkimTried && data.dkimTried.length > 0 && (
            <span className="ml-2 font-sans text-[var(--muted-foreground)]">
              {t.documents.domain.dkimTried(data.dkimTried.join(", "))}
            </span>
          )}
        </>
      ),
    },
  ];

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-[var(--muted-foreground)]">
            <th className="py-1 pr-3 font-medium">
              {t.documents.domain.check}
            </th>
            <th className="py-1 pr-3 font-medium">
              {t.documents.domain.finding}
            </th>
            <th className="py-1 font-medium">{t.documents.domain.record}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name} className="border-t align-top">
              <td className="py-1.5 pr-3 font-medium whitespace-nowrap">
                {row.name}
              </td>
              <td className="py-1.5 pr-3">
                {row.finding && (
                  <span className="flex items-start gap-2">
                    <span
                      aria-hidden
                      className={`mt-1.5 size-2 shrink-0 rounded-full ${DOT[row.finding.severity]}`}
                    />
                    <span>{row.finding.message}</span>
                  </span>
                )}
              </td>
              <td className="py-1.5 font-mono text-xs break-all">
                {row.record}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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

/** A small label naming what a TXT record is for, when that can be told. */
function TxtRecord({ value }: { value: string }) {
  const { label } = classifyTxt(value);
  return (
    <li className="flex flex-wrap items-baseline gap-2">
      <span className="min-w-0 break-all font-mono text-xs">{value}</span>
      {label && (
        <span className="shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-[var(--muted-foreground)] uppercase">
          {label}
        </span>
      )}
    </li>
  );
}

const selectClass =
  "h-9 w-full rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

/**
 * The checks a domain record runs, how often each runs on its own, and what
 * the last run found. Nothing is looked up while a page is being read: a
 * result is fetched when somebody asks or when a kind's clock says so, and
 * kept until the next time.
 */
export function DomainPanel({
  documentId,
  state,
  editor,
  current,
  checkedAt,
  nextRunAt,
}: {
  documentId: string;
  state: DomainCheckState;
  editor: boolean;
  /** What the record already says, for comparing a suggestion against, and which of those are dropdown options. */
  current: {
    expiry: string | null;
    registrar: string | null;
    dnsHost: string | null;
    options: { expiry: boolean; registrar: boolean; dnsHost: boolean };
  };
  /** ISO, because a Date crosses the boundary as a string anyway. */
  checkedAt: string | null;
  nextRunAt: string | null;
}) {
  const t = useMessages();
  const locale = useLocale();
  const [saveState, saveAction] = useActionState<FormState, FormData>(
    saveDomainChecksAction,
    {},
  );
  const [runState, runAction] = useActionState<FormState, FormData>(
    runDomainCheckAction,
    {},
  );

  const result = state.result;
  // Sorted at render as well as at fetch, so a result kept from before reads the same way.
  const dns = result?.dns?.ok ? orderDns(result.dns.data) : null;
  const { automation } = state;
  const when = (value: string | Date | null | undefined) =>
    value ? formatDateTime(new Date(value), locale) : null;
  const describe = (days: number) =>
    days === 0 ? t.documents.domain.off : t.documents.domain.every(days);
  /** What "default" means for this kind: the company's word if it has one, else the instance's. */
  const defaultLabel = (kind: CheckKind) => {
    const company = automation.company.intervals[kind];
    return company !== null && company !== undefined
      ? t.documents.domain.companyDefault(describe(company))
      : t.documents.domain.instanceDefault(
          describe(automation.instance.intervals[kind]),
        );
  };
  const policyWarnDays =
    automation.company.tlsWarnDays ?? automation.instance.tlsWarnDays;

  const kinds: { kind: CheckKind; label: string; hint: string }[] = [
    {
      kind: "dns",
      label: t.documents.domain.dns,
      hint: t.documents.domain.dnsHint,
    },
    {
      kind: "tls",
      label: t.documents.domain.tls,
      hint: t.documents.domain.tlsHint,
    },
    {
      kind: "rdap",
      label: t.documents.domain.rdap,
      hint: t.documents.domain.rdapHint,
    },
    {
      kind: "email",
      label: t.documents.domain.email,
      hint: t.documents.domain.emailHint,
    },
  ];
  const anythingChosen = kinds.some(({ kind }) => state.selection[kind]);
  const nothingRuns =
    automation.auto &&
    anythingChosen &&
    activeKinds(state.selection, automation.effective).length === 0;

  const sectionMeta = (kind: CheckKind): string[] => {
    const out: string[] = [];
    const fetched = when(
      result?.checked?.[kind] ?? (result?.[kind] ? result.checkedAt : null),
    );
    if (fetched) out.push(t.documents.domain.sectionChecked(fetched));
    const next = automation.auto ? when(automation.nextRuns[kind]) : null;
    if (next) out.push(t.documents.domain.sectionNext(next));
    return out;
  };

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h3 className="text-lg font-semibold tracking-tight">
          {t.documents.domain.heading}
        </h3>
        <p className="text-sm text-[var(--muted-foreground)]">
          {t.documents.domain.subtitle}
        </p>
      </div>

      {editor && (
        <form
          action={saveAction}
          className="flex flex-col gap-3 rounded-md border p-4"
        >
          <FormError>{saveState.error}</FormError>
          <input type="hidden" name="documentId" value={documentId} />

          <fieldset className="flex flex-col gap-3">
            {kinds.map(({ kind, label, hint }) => {
              const own = automation.own.intervals[kind];
              return (
                <div
                  key={kind}
                  className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-start sm:gap-4"
                >
                  <label className="flex flex-1 items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      name={kind}
                      defaultChecked={state.selection[kind]}
                      className="mt-0.5 size-4 rounded border"
                    />
                    <span>
                      <span className="font-medium">{label}</span>
                      <span className="block text-xs text-[var(--muted-foreground)]">
                        {hint}
                      </span>
                    </span>
                  </label>

                  <label className="flex flex-col gap-1 text-sm sm:w-64">
                    <span className="text-xs text-[var(--muted-foreground)]">
                      {t.documents.domain.interval}
                    </span>
                    <Select
                      name={`${kind}IntervalDays`}
                      aria-label={`${label}: ${t.documents.domain.interval}`}
                      defaultValue={own === null ? "" : String(own)}
                      className={selectClass}
                    >
                      <option value="">{defaultLabel(kind)}</option>
                      {intervalChoices(own).map((days) => (
                        <option key={days} value={String(days)}>
                          {t.documents.domain.intervalEvery(days)}
                        </option>
                      ))}
                    </Select>
                  </label>

                  {kind === "tls" && (
                    <div className="flex flex-col gap-2 sm:basis-full sm:pl-6">
                      <label className="flex items-start gap-2 text-sm">
                        <input
                          type="checkbox"
                          name="tlsAutoRenews"
                          defaultChecked={automation.own.tlsAutoRenews}
                          className="mt-0.5 size-4 rounded border"
                        />
                        <span>
                          <span className="font-medium">
                            {t.documents.domain.autoRenews}
                          </span>
                          <span className="block text-xs text-[var(--muted-foreground)]">
                            {t.documents.domain.autoRenewsHint}
                          </span>
                        </span>
                      </label>
                      <label className="flex flex-col gap-1 text-sm sm:w-64">
                        <span className="text-xs text-[var(--muted-foreground)]">
                          {t.documents.domain.tlsWarn}
                        </span>
                        <Select
                          name="tlsWarnDays"
                          aria-label={t.documents.domain.tlsWarn}
                          defaultValue={
                            automation.own.tlsWarnDays === null
                              ? ""
                              : String(automation.own.tlsWarnDays)
                          }
                          className={selectClass}
                        >
                          <option value="">
                            {t.documents.domain.tlsWarnDefault(policyWarnDays)}
                          </option>
                          {warnChoices(automation.own.tlsWarnDays).map(
                            (days) => (
                              <option key={days} value={String(days)}>
                                {t.documents.domain.tlsWarnDays(days)}
                              </option>
                            ),
                          )}
                        </Select>
                      </label>
                    </div>
                  )}

                  {kind === "email" && (
                    <label className="flex flex-col gap-1 text-sm sm:basis-full sm:pl-6">
                      <span className="font-medium">
                        {t.documents.domain.dkimSelectors}
                      </span>
                      <input
                        type="text"
                        name="dkimSelectors"
                        defaultValue={automation.own.dkimSelectors.join(", ")}
                        placeholder="selector1, selector2"
                        className="h-9 w-full rounded-md border bg-transparent px-3 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] sm:max-w-md"
                      />
                      <span className="text-xs text-[var(--muted-foreground)]">
                        {t.documents.domain.dkimSelectorsHint}
                      </span>
                    </label>
                  )}
                </div>
              );
            })}
          </fieldset>

          <fieldset className="flex flex-col gap-2 rounded-md border p-3">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                name="auto"
                defaultChecked={automation.auto}
                className="mt-0.5 size-4 rounded border"
              />
              <span>
                <span className="font-medium">
                  {t.documents.domain.automatic}
                </span>
                <span className="block text-xs text-[var(--muted-foreground)]">
                  {t.documents.domain.automaticHint}
                </span>
              </span>
            </label>
            {nothingRuns && (
              <p className="text-xs text-[var(--muted-foreground)]">
                {t.documents.domain.automaticOff}
              </p>
            )}
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
            <RunButton
              label={t.documents.domain.run}
              busy={t.documents.domain.running}
            />
          </form>
        )}

        <p className="text-sm text-[var(--muted-foreground)]">
          {checkedAt
            ? state.automatic
              ? t.documents.domain.lastCheckedAuto(
                  formatDateTime(new Date(checkedAt), locale),
                )
              : t.documents.domain.lastChecked(
                  formatDateTime(new Date(checkedAt), locale),
                )
            : t.documents.domain.never}
          {nextRunAt && automation.auto && (
            <>
              {" "}
              {t.documents.domain.nextRun(
                formatDateTime(new Date(nextRunAt), locale),
              )}
            </>
          )}
        </p>
      </div>

      {automation.autoError && (
        <p className="text-sm text-[var(--destructive)]">
          {t.documents.domain.autoError(automation.autoError)}
        </p>
      )}

      <FormError>{runState.error}</FormError>

      {!state.targets.domain && (
        <p className="text-sm text-[var(--muted-foreground)]">
          {t.documents.domain.noField}
        </p>
      )}
      {state.targets.domain && !state.rawDomain && (
        <p className="text-sm text-[var(--muted-foreground)]">
          {t.documents.domain.noDomain}
        </p>
      )}
      {state.rawDomain && !state.domain && (
        <p className="text-sm text-[var(--destructive)]">
          {t.documents.domain.notADomain(state.rawDomain)}
        </p>
      )}

      {result && (
        <div className="flex flex-col gap-3">
          <Section
            title={t.documents.domain.dns}
            section={result.dns}
            meta={sectionMeta("dns")}
          >
            {dns && (
              <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 text-sm">
                {(
                  [
                    ["A", dns.a.join(", ")],
                    ["AAAA", dns.aaaa.join(", ")],
                    [t.documents.domain.cname, dns.cname.join(", ")],
                    [
                      "MX",
                      dns.mx
                        .map((mx) => `${mx.priority} ${mx.exchange}`)
                        .join(", "),
                    ],
                    ["NS", dns.ns.join(", ")],
                  ] as const
                )
                  .filter(([, value]) => value !== "")
                  .map(([name, value]) => (
                    <div key={name} className="contents">
                      <dt className="text-[var(--muted-foreground)]">{name}</dt>
                      <dd className="break-words font-mono text-xs">{value}</dd>
                    </div>
                  ))}
                {dns.txt.length > 0 && (
                  <div className="contents">
                    <dt className="text-[var(--muted-foreground)]">
                      {t.documents.domain.txt}
                    </dt>
                    <dd>
                      <ul className="flex list-disc flex-col gap-1 pl-4 marker:text-[var(--muted-foreground)]">
                        {dns.txt.map((value, index) => (
                          <TxtRecord key={index} value={value} />
                        ))}
                      </ul>
                    </dd>
                  </div>
                )}
              </dl>
            )}

            {editor && dns && dns.ns[0] && state.targets.dns_host && (
              <Suggestion
                documentId={documentId}
                role="dns_host"
                label={t.documents.domain.dnsHost}
                // "dara.ns.cloudflare.com" is answered by Cloudflare.
                value={nameServerBrand(dns.ns[0])}
                current={current.dnsHost}
                option={current.options.dnsHost}
              />
            )}
          </Section>

          <Section
            title={t.documents.domain.tls}
            section={result.tls}
            meta={sectionMeta("tls")}
          >
            {result.tls?.ok && (
              <div className="flex flex-col gap-1 text-sm text-[var(--muted-foreground)]">
                <p>
                  {result.tls.data.issuer} · {result.tls.data.names.join(", ")}
                  {result.tls.data.validTo && (
                    <>
                      {" "}
                      · {t.documents.domain.expiry}{" "}
                      {result.tls.data.validTo.slice(0, 10)}
                    </>
                  )}
                </p>
                {automation.certificateWarnDays === null && (
                  <p className="text-xs">{t.documents.domain.tlsNoWarning}</p>
                )}
              </div>
            )}
          </Section>

          <Section
            title={t.documents.domain.rdap}
            section={result.rdap}
            meta={sectionMeta("rdap")}
          >
            {editor && result.rdap?.ok && (
              <div className="flex flex-col gap-2">
                {result.rdap.data.registrar && state.targets.registrar && (
                  <Suggestion
                    documentId={documentId}
                    role="registrar"
                    label={t.documents.domain.registrar}
                    value={result.rdap.data.registrar}
                    current={current.registrar}
                    option={current.options.registrar}
                  />
                )}
                {result.rdap.data.expires && state.targets.expiry && (
                  <Suggestion
                    documentId={documentId}
                    role="expiry"
                    label={t.documents.domain.expiry}
                    value={result.rdap.data.expires.slice(0, 10)}
                    current={current.expiry}
                    option={current.options.expiry}
                  />
                )}
              </div>
            )}
          </Section>

          <Section
            title={t.documents.domain.email}
            section={result.email}
            meta={sectionMeta("email")}
            hideFindings
          >
            {result.email?.ok && (
              <EmailTable
                data={result.email.data}
                findings={result.email.findings}
              />
            )}
          </Section>
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

/** The intervals offered, plus whatever this record already has. */
function intervalChoices(current: number | null): number[] {
  const choices: number[] = [...INTERVAL_CHOICES];
  if (current && !choices.includes(current)) choices.push(current);
  return choices.sort((a, b) => a - b);
}

function warnChoices(current: number | null): number[] {
  const choices: number[] = [...TLS_WARN_CHOICES];
  if (current && !choices.includes(current)) choices.push(current);
  return choices.sort((a, b) => a - b);
}
