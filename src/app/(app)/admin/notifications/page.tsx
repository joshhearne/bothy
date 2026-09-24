import Link from "next/link";
import { requireScopedUser } from "@/server/auth/session";
import { listDue } from "@/server/services/schedules";
import { getMessages } from "@/i18n/server";

export const dynamic = "force-dynamic";

/**
 * What is due or overdue, across every company the reader may see. The list is
 * the same thing the webhook announces, so nobody has to subscribe to a
 * webhook to find out what needs doing.
 */
export default async function NotificationsPage() {
  const { scope } = await requireScopedUser();
  const [due, t] = await Promise.all([listDue(scope), getMessages()]);

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
    </div>
  );
}
