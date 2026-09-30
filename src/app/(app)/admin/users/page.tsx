import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  ROLES,
  canManageIntegrations,
  requireRecentMfa,
  requireScopedUser,
} from "@/server/auth/session";
import { listUsers } from "@/server/services/users";
import { listCompanies } from "@/server/services/companies";
import { mfaSummaries } from "@/server/services/mfa";
import { CompanyAccessFieldset } from "@/components/company-access-fieldset";
import { formatDateTime } from "@/i18n/format";
import { getI18n } from "@/i18n/server";
import { setCanRevealAction, setUserCompaniesAction, setUserRoleAction } from "../vault-actions";
import { resetMfaAction, unlockUserAction } from "../user-actions";
import { NewUserForm, TemporaryPasswordForm } from "../user-forms";
import { Select } from "@/components/ui/select";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const { user, scope } = await requireScopedUser();
  if (!canManageIntegrations(user.role)) redirect("/companies");
  await requireRecentMfa(user, "/admin/users");

  const [users, companies, { locale, messages: t }] = await Promise.all([
    listUsers(),
    listCompanies(scope),
    getI18n(),
  ]);
  const security = await mfaSummaries(users.map((row) => row.id));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.admin.users.title}</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          {t.admin.users.subtitle}
        </p>
      </div>

      <NewUserForm roles={ROLES} />

      <ul className="flex flex-col gap-2">
        {users.map((row) => {
          const mfa = security.get(row.id);
          const factors = [
            mfa?.totp ? t.admin.users.mfaTotp : null,
            mfa && mfa.passkeys > 0 ? t.admin.users.mfaPasskeys(mfa.passkeys) : null,
          ].filter(Boolean);
          const enrolled = factors.length > 0;
          const due =
            !enrolled && row.role === "admin" && mfa?.deadline
              ? mfa.overdue
                ? t.admin.users.mfaOverdue
                : t.admin.users.mfaDue(formatDateTime(mfa.deadline, locale))
              : null;
          const lockedUntil = mfa?.lockedUntil ?? null;

          return (
          <li key={row.id} className="flex flex-wrap items-center gap-3 rounded-md border px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{row.name}</p>
              <p className="text-sm text-[var(--muted-foreground)]">{row.email}</p>
              <p className="text-xs text-[var(--muted-foreground)]">
                {t.admin.users.mfa}: {enrolled ? factors.join(", ") : t.admin.users.mfaNone}
                {due ? ` · ${due}` : ""}
                {lockedUntil ? ` · ${t.admin.users.locked(formatDateTime(lockedUntil, locale))}` : ""}
              </p>
            </div>

            {lockedUntil && (
              <form action={unlockUserAction}>
                <input type="hidden" name="id" value={row.id} />
                <Button type="submit" variant="outline" size="sm">
                  {t.admin.users.unlock}
                </Button>
              </form>
            )}
            {enrolled && row.id !== user.id && (
              <form action={resetMfaAction}>
                <input type="hidden" name="id" value={row.id} />
                <Button type="submit" variant="outline" size="sm" title={t.admin.users.resetMfaHint}>
                  {t.admin.users.resetMfa}
                </Button>
              </form>
            )}

            <form action={setUserRoleAction} className="flex items-center gap-2">
              <input type="hidden" name="id" value={row.id} />
              <label className="sr-only" htmlFor={`role-${row.id}`}>
                {t.admin.users.roleFor(row.email)}
              </label>
              <Select
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
              </Select>
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

            <details className="w-full">
              <summary className="cursor-pointer text-sm text-[var(--muted-foreground)]">
                {t.access.legend}:{" "}
                {row.role === "admin"
                  ? t.admin.users.accessSummaryAll
                  : row.allCompanies
                    ? t.admin.users.accessSummaryAll
                    : row.companyIds.length === 0
                      ? t.admin.users.accessSummaryNone
                      : t.admin.users.accessSummaryCount(row.companyIds.length)}
              </summary>

              {row.role === "admin" ? (
                <p className="pt-3 text-sm text-[var(--muted-foreground)]">
                  {t.admin.users.adminSeesEverything}
                </p>
              ) : (
                <form action={setUserCompaniesAction} className="flex flex-col gap-3 pt-3">
                  <input type="hidden" name="id" value={row.id} />
                  <fieldset aria-label={t.admin.users.accessFor(row.email)}>
                    <CompanyAccessFieldset
                      companies={companies.map((company) => ({
                        id: company.id,
                        name: company.name,
                      }))}
                      allCompanies={row.allCompanies}
                      selected={row.companyIds}
                      hint={t.access.hint}
                    />
                  </fieldset>
                  <div>
                    <Button type="submit" variant="outline" size="sm">
                      {t.access.save}
                    </Button>
                  </div>
                </form>
              )}
            </details>

            {row.id !== user.id && (
              <TemporaryPasswordForm userId={row.id} owner={{ email: row.email, name: row.name }} />
            )}
          </li>
          );
        })}
      </ul>
    </div>
  );
}
