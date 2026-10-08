import Link from "next/link";
import { requireScopedUser } from "@/server/auth/session";
import { listDue } from "@/server/services/schedules";
import { listDomainAttention } from "@/server/services/domain-checks";
import { getLocale } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { getMessages } from "@/i18n/server";

export const dynamic = "force-dynamic";

/**
 * What is due or overdue, across every company the reader may see. The list is
 * the same thing the webhook announces, so nobody has to subscribe to a
 * webhook to find out what needs doing.
 */
export default async function NotificationsPage() {
  const { scope } = await requireScopedUser();
  const [due, t, domains, locale] = await Promise.all([
    listDue(scope),
    getMessages(),
    listDomainAttention(scope),
    getLocale(),
  ]);

  const overdue = due.filter((item) => item.status === "overdue");
  const soon = due.filter((item) => item.status === "due_soon");

  const groups = [
    { title: t.admin.notifications.overdue, items: overdue, tone: "text-[var(--destructive)]" },
    { title: t.admin.notifications.dueSoon, items: soon, tone: "" },
  ].filter((group) => group.items.length > 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{t.admin.notifications.title}</h2>
        <p className="text-sm text-[var(--muted-foreground)]">
          {t.admin.notifications.subtitle}
        </p>
      </div>

      {groups.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">{t.admin.notifications.empty}</p>
      ) : (
        groups.map((group) => (
          <section key={group.title} className="flex flex-col gap-2">
            <h3 className={`text-sm font-medium ${group.tone}`}>
              {group.title} ({group.items.length})
            </h3>

            <ul className="flex flex-col gap-1">
              {group.items.map((item) => (
                <li
                  key={item.documentId}
                  className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 text-sm"
                >
                  <span className="min-w-0 flex-1">
                    <Link href={`/documents/${item.documentId}`} className="hover:underline">
                      {item.title}
                    </Link>
                    <span className="ml-2 text-xs text-[var(--muted-foreground)]">
                      {item.companyName} · {item.docTypeName}
                    </span>
                  </span>

                  <span className="font-mono text-xs text-[var(--muted-foreground)]">
                    {t.admin.notifications.due(item.dueOn)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      <section className="flex flex-col gap-2">
        <div>
          <h3 className="text-sm font-medium">
            {t.admin.notifications.domains} ({domains.length})
          </h3>
          <p className="text-sm text-[var(--muted-foreground)]">
            {t.admin.notifications.domainsHint}
          </p>
        </div>

        {domains.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">
            {t.admin.notifications.domainsEmpty}
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {domains.map((item) => (
              <li key={item.documentId} className="flex flex-col gap-1 rounded-md border px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="min-w-0 flex-1">
                    <Link href={`/documents/${item.documentId}`} className="hover:underline">
                      {item.title}
                    </Link>
                    <span className="ml-2 text-xs text-[var(--muted-foreground)]">
                      {item.companyName} · {item.docTypeName} · {item.domain}
                    </span>
                  </span>
                  <span className="font-mono text-xs text-[var(--muted-foreground)]">
                    {t.admin.notifications.checked(formatDateTime(item.checkedAt, locale))}
                  </span>
                </div>
                <ul className="flex flex-col gap-0.5 text-xs">
                  {item.autoError && (
                    <li className="text-[var(--destructive)]">
                      {t.documents.domain.autoError(item.autoError)}
                    </li>
                  )}
                  {item.findings.map((finding, index) => (
                    <li
                      key={index}
                      className={
                        finding.severity === "bad"
                          ? "text-[var(--destructive)]"
                          : "text-[var(--muted-foreground)]"
                      }
                    >
                      {finding.message}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
