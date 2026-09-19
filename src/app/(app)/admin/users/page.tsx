import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ROLES, canManageIntegrations, requireUser } from "@/server/auth/session";
import { listUsers } from "@/server/services/users";
import { getMessages } from "@/i18n/server";
import { setCanRevealAction, setUserRoleAction } from "../vault-actions";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const user = await requireUser();
  if (!canManageIntegrations(user.role)) redirect("/companies");

  const users = await listUsers();
  const t = await getMessages();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.admin.users.title}</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          {t.admin.users.subtitle}
        </p>
      </div>

      <ul className="flex flex-col gap-2">
        {users.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center gap-3 rounded-md border px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{row.name}</p>
              <p className="text-sm text-[var(--muted-foreground)]">{row.email}</p>
            </div>

            <form action={setUserRoleAction} className="flex items-center gap-2">
              <input type="hidden" name="id" value={row.id} />
              <label className="sr-only" htmlFor={`role-${row.id}`}>
                {t.admin.users.roleFor(row.email)}
              </label>
              <select
                id={`role-${row.id}`}
                name="role"
                defaultValue={row.role}
                className="h-9 rounded-md border bg-transparent px-2 text-sm"
              >
                {ROLES.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
              <Button type="submit" variant="outline" size="sm">
                {t.admin.users.setRole}
              </Button>
            </form>

            <form action={setCanRevealAction} className="flex items-center gap-2">
              <input type="hidden" name="id" value={row.id} />
              {!row.canRevealSecrets && <input type="hidden" name="canReveal" value="on" />}
              <span className="text-sm text-[var(--muted-foreground)]">
                {row.canRevealSecrets ? t.admin.users.mayReveal : t.admin.users.mayNotReveal}
              </span>
              <Button type="submit" variant="outline" size="sm">
                {row.canRevealSecrets ? t.admin.users.revoke : t.admin.users.grant}
              </Button>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}
