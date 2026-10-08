import { Check, Lock } from "lucide-react";
import {
  canManageIntegrations,
  requireRecentMfa,
  requireUser,
} from "@/server/auth/session";
import { redirect } from "next/navigation";
import { listRoles } from "@/server/services/roles";
import { PERMISSIONS } from "@/server/auth/permissions";
import { getMessages } from "@/i18n/server";
import { EditRoleForm, NewRoleForm } from "../role-forms";

export const dynamic = "force-dynamic";

/**
 * What each role may do, as a matrix, and the roles an administrator has
 * made beneath it. The three built-in roles are the product's word and
 * cannot be changed; a custom role carries whatever subset was chosen.
 */
export default async function RolesPage() {
  const user = await requireUser();
  if (!canManageIntegrations(user.role)) redirect("/companies");
  await requireRecentMfa(user, "/admin/roles");
  const [roles, t] = await Promise.all([listRoles(), getMessages()]);
  const p = t.admin.roles;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{p.title}</h1>
        <p className="text-sm text-[var(--muted-foreground)]">{p.subtitle}</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-[var(--muted-foreground)]">
              <th className="py-2 pr-3 font-medium">{p.role}</th>
              {PERMISSIONS.map((permission) => (
                <th
                  key={permission}
                  className="px-2 py-2 text-center font-medium"
                  title={p.permission[permission].hint}
                >
                  {p.permission[permission].name}
                </th>
              ))}
              <th className="py-2 pl-3 text-right font-medium">{p.holders}</th>
            </tr>
          </thead>
          <tbody>
            {roles.map((role) => (
              <tr key={role.key} className="border-t align-top">
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium">{role.name}</span>
                    {role.builtin && (
                      <Lock
                        className="size-3.5 text-[var(--muted-foreground)]"
                        aria-label={p.builtin}
                      />
                    )}
                  </div>
                  <div className="font-mono text-xs text-[var(--muted-foreground)]">
                    {role.key}
                  </div>
                  {role.description && (
                    <div className="text-xs text-[var(--muted-foreground)]">
                      {role.description}
                    </div>
                  )}
                </td>
                {PERMISSIONS.map((permission) => (
                  <td key={permission} className="px-2 py-2 text-center">
                    {role.permissions.includes(permission) ? (
                      <Check
                        className="mx-auto size-4 text-[var(--success)]"
                        aria-label={p.yes}
                      />
                    ) : (
                      <span
                        className="text-[var(--muted-foreground)]"
                        aria-label={p.no}
                      >
                        ·
                      </span>
                    )}
                  </td>
                ))}
                <td className="py-2 pl-3 text-right tabular-nums">
                  {role.holders}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-[var(--muted-foreground)]">{p.builtinHint}</p>

      {roles.some((role) => !role.builtin) && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold tracking-tight">{p.custom}</h2>
          <ul className="flex flex-col gap-3">
            {roles
              .filter((role) => !role.builtin)
              .map((role) => (
                <li key={role.key} className="rounded-md border p-4">
                  <h3 className="mb-2 font-medium">
                    {role.name}{" "}
                    <span className="font-mono text-xs text-[var(--muted-foreground)]">
                      {role.key}
                    </span>
                  </h3>
                  <EditRoleForm role={role} />
                </li>
              ))}
          </ul>
        </section>
      )}

      <NewRoleForm />
    </div>
  );
}
