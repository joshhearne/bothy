import Link from "next/link";
import type { Route } from "next";
import { Check, CircleAlert, CircleDashed } from "lucide-react";
import { requireRecentMfa, requireUser } from "@/server/auth/session";
import { portalStatus, type HostnameCheck } from "@/server/kb/portal";
import { visitorAddress } from "@/server/kb/public";
import { getI18n } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { KbPublicForm } from "../settings-forms";

export const dynamic = "force-dynamic";

type Tone = "done" | "todo" | "warn";

function Mark({ tone }: { tone: Tone }) {
  const Icon =
    tone === "done" ? Check : tone === "warn" ? CircleAlert : CircleDashed;
  const color =
    tone === "done"
      ? "text-[var(--success)]"
      : tone === "warn"
        ? "text-[var(--warning)]"
        : "text-[var(--muted-foreground)]";
  return <Icon className={`mt-0.5 size-4 shrink-0 ${color}`} aria-hidden />;
}

function Step({
  tone,
  title,
  detail,
  children,
}: {
  tone: Tone;
  title: string;
  detail?: string;
  children?: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-3 rounded-md border p-3">
      <Mark tone={tone} />
      <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
        <span className="font-medium">{title}</span>
        {detail && (
          <span className="text-[var(--muted-foreground)]">{detail}</span>
        )}
        {children}
      </div>
    </li>
  );
}

/**
 * Standing up the public knowledge base on a hostname of its own: what is
 * set, what answers, what is on the site, and the steps outside this
 * installation. The form that was under Settings lives here now, with the
 * things it depends on around it.
 */
export default async function PortalPage() {
  await requireRecentMfa(await requireUser(), "/admin/portal");
  const [{ locale, messages: t }, status, visitor] = await Promise.all([
    getI18n(),
    portalStatus(),
    visitorAddress(),
  ]);
  const p = t.admin.portal;
  const { settings } = status;

  const onSite = status.collections.filter((c) => c.publicAccess);
  const hostnameTone: Tone =
    status.hostname.state === "answers" && status.hostname.status === 200
      ? "done"
      : status.hostname.state === "unset"
        ? "todo"
        : "warn";
  const hostnameDetail = (check: HostnameCheck): string => {
    switch (check.state) {
      case "unset":
        return p.hostnameUnset;
      case "answers":
        return check.status === 200
          ? p.hostnameAnswers
          : p.hostnameAnswersOther(check.status);
      case "refused":
        return p.hostnameRefused(check.reason);
      case "unreachable":
        return p.hostnameUnreachable;
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{p.title}</h1>
        <p className="text-sm text-[var(--muted-foreground)]">{p.subtitle}</p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">{p.status}</h2>
        <ol className="flex flex-col gap-2">
          <Step
            tone={settings.mode === "off" ? "todo" : "done"}
            title={p.stepMode}
            detail={t.admin.settings.publicModes[settings.mode]}
          />
          <Step
            tone={settings.url ? "done" : "todo"}
            title={p.stepUrl}
            detail={settings.url ?? p.urlUnset}
          />
          <Step
            tone={hostnameTone}
            title={p.stepHostname}
            detail={hostnameDetail(status.hostname)}
          />
          <Step
            tone={status.accessConfigured ? "done" : "todo"}
            title={p.stepAccess}
            detail={
              status.accessConfigured
                ? status.accessLastVerifiedAt
                  ? p.accessSeen(
                      formatDateTime(status.accessLastVerifiedAt, locale),
                    )
                  : p.accessNotSeen
                : p.accessUnset
            }
          />
          <Step
            tone={onSite.length > 0 ? "done" : "todo"}
            title={p.stepCollections}
            detail={t.admin.settings.publicCollections(onSite.length)}
          >
            {status.collections.length > 0 && (
              <ul className="mt-1 flex flex-col gap-0.5 text-xs">
                {status.collections.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/admin/kb/${c.id}` as Route}
                      className="hover:underline"
                    >
                      {c.name}
                    </Link>
                    <span className="text-[var(--muted-foreground)]">
                      {c.publicAccess ? p.onSite : p.notOnSite}
                      {" · "}
                      {c.allCompanies
                        ? p.everyCompany
                        : p.keptTo(c.keptTo.join(", "))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Step>
          <Step
            tone={status.companies.length > 0 ? "done" : "todo"}
            title={p.stepCustomers}
            detail={
              status.companies.length > 0
                ? p.customersSet(status.companies.length)
                : p.customersUnset
            }
          >
            {status.companies.length > 0 && (
              <ul className="mt-1 flex flex-col gap-0.5 text-xs">
                {status.companies.map((c) => (
                  <li
                    key={c.companyId}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <Link
                      href={`/companies/${c.companyId}/edit` as Route}
                      className="hover:underline"
                    >
                      {c.name}
                    </Link>
                    <span className="font-mono text-[var(--muted-foreground)]">
                      {c.domains.join(", ")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Step>
          <Step
            tone={
              status.branding.kbPoweredByName || status.branding.logoUrl
                ? "done"
                : "todo"
            }
            title={p.stepBranding}
            detail={
              status.branding.kbPoweredByName
                ? p.brandingSet(status.branding.kbPoweredByName)
                : p.brandingUnset
            }
          >
            <Link
              href={"/admin/branding" as Route}
              className="text-xs underline"
            >
              {t.nav.branding}
            </Link>
          </Step>
        </ol>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">{p.cloudflare}</h2>
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
          {p.cloudflareSteps.map((step, index) => (
            <li key={index}>{step}</li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            {t.admin.settings.publicKb}
          </h2>
          <p className="text-sm text-[var(--muted-foreground)]">
            {t.admin.settings.publicKbHint}
          </p>
        </div>
        <KbPublicForm
          mode={settings.mode}
          addresses={settings.addressText}
          url={settings.url ?? ""}
          accessTeam={settings.accessTeam ?? ""}
          accessAud={settings.accessAud ?? ""}
          visitor={visitor}
        />
      </section>
    </div>
  );
}
