import Link from "next/link";
import { redirect } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";
import { canManageIntegrations, requireUser } from "@/server/auth/session";
import { listAuditActions, listAuditLog } from "@/server/services/audit";
import { listUsers } from "@/server/services/users";
import { formatDateTime } from "@/i18n/format";
import { getI18n } from "@/i18n/server";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

const selectClass =
  "h-10 rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{
    action?: string;
    entity?: string;
    user?: string;
    from?: string;
    to?: string;
    before?: string;
  }>;
}) {
  const viewer = await requireUser();
  if (!canManageIntegrations(viewer.role)) redirect("/companies");

  const params = await searchParams;
  const before = params.before ? Number.parseInt(params.before, 10) : undefined;

  const [rows, actions, users] = await Promise.all([
    listAuditLog({
      action: params.action || undefined,
      entity: params.entity || undefined,
      userId: params.user || undefined,
      from: params.from || undefined,
      to: params.to || undefined,
      limit: PAGE_SIZE,
      before: Number.isFinite(before) ? before : undefined,
    }),
    listAuditActions(),
    listUsers(),
  ]);

  const { locale, messages: t } = await getI18n();
  const oldest = rows.at(-1)?.id;
  const nextQuery = {
    ...(params.action ? { action: params.action } : {}),
    ...(params.entity ? { entity: params.entity } : {}),
    ...(params.user ? { user: params.user } : {}),
    ...(params.from ? { from: params.from } : {}),
    ...(params.to ? { to: params.to } : {}),
    ...(oldest ? { before: String(oldest) } : {}),
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.admin.audit.title}</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          {t.admin.audit.subtitle}
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="action" className="text-sm font-medium">
            {t.admin.audit.action}
          </label>
          <select id="action" name="action" defaultValue={params.action ?? ""} className={selectClass}>
            <option value="">{t.admin.audit.anyAction}</option>
            {actions.map((action) => (
              <option key={action} value={action}>
                {action}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="user" className="text-sm font-medium">
            {t.admin.audit.user}
          </label>
          <select id="user" name="user" defaultValue={params.user ?? ""} className={selectClass}>
            <option value="">{t.admin.audit.anyone}</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.email}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="from" className="text-sm font-medium">
            {t.admin.audit.from}
          </label>
          <Input id="from" name="from" type="date" defaultValue={params.from ?? ""} />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="to" className="text-sm font-medium">
            {t.admin.audit.to}
          </label>
          <Input id="to" name="to" type="date" defaultValue={params.to ?? ""} />
        </div>

        <Button type="submit">{t.admin.audit.filter}</Button>
        <Link href="/admin/audit" className={buttonVariants({ variant: "ghost" })}>
          {t.admin.audit.clear}
        </Link>
      </form>

      {rows.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">{t.admin.audit.empty}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-[var(--muted-foreground)]">
              <tr>
                <th className="px-4 py-2 font-medium">{t.admin.audit.when}</th>
                <th className="px-4 py-2 font-medium">{t.admin.audit.who}</th>
                <th className="px-4 py-2 font-medium">{t.admin.audit.action}</th>
                <th className="px-4 py-2 font-medium">{t.admin.audit.entity}</th>
                <th className="px-4 py-2 font-medium">{t.admin.audit.detail}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b last:border-b-0 align-top">
                  <td className="whitespace-nowrap px-4 py-2">
                    {formatDateTime(row.createdAt, locale)}
                  </td>
                  <td className="px-4 py-2">{row.userEmail ?? t.admin.audit.apiKey}</td>
                  <td className="px-4 py-2">
                    <code>{row.action}</code>
                  </td>
                  <td className="px-4 py-2">
                    {row.entity}
                    {row.entityId && (
                      <span className="block text-xs text-[var(--muted-foreground)]">
                        {row.entityId}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {row.detail ? (
                      <code className="text-xs">{JSON.stringify(row.detail)}</code>
                    ) : (
                      <span className="text-[var(--muted-foreground)]">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length === PAGE_SIZE && oldest && (
        <div>
          <Link
            href={{ pathname: "/admin/audit", query: nextQuery }}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            {t.admin.audit.older}
          </Link>
        </div>
      )}
    </div>
  );
}
