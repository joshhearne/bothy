import Link from "next/link";
import { Building2, Plus } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

import { canManageHierarchy, requireScopedUser } from "@/server/auth/session";
import { getI18n } from "@/i18n/server";
import { plural } from "@/i18n/format";
import { listCompanies } from "@/server/services/companies";
import { unarchiveCompanyAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const { user, scope } = await requireScopedUser();
  const { archived } = await searchParams;
  const showArchived = archived === "1";
  const companies = await listCompanies(scope, { includeArchived: showArchived });
  const writer = canManageHierarchy(user.role);
  const { locale, messages: t } = await getI18n();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t.companies.title}</h1>
        <div className="flex items-center gap-2">
          <Link
            href={showArchived ? "/companies" : { pathname: "/companies", query: { archived: "1" } }}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            {showArchived ? t.common.hideArchived : t.common.showArchived}
          </Link>
          {writer && (
            <Link
              href="/companies/new"
              className={buttonVariants({ size: "sm" })}
            >
              <Plus className="size-4" aria-hidden />
              {t.nav.newCompany}
            </Link>
          )}
        </div>
      </div>

      {companies.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-3 p-6">
            <p className="text-sm text-[var(--muted-foreground)]">
              {scope.all ? t.companies.empty : t.companies.noneGranted}
            </p>
            {writer && (
              <Link
                href="/companies/new"
                className={buttonVariants({ size: "sm" })}
              >
                <Plus className="size-4" aria-hidden />
                {t.nav.newCompany}
              </Link>
            )}
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {companies.map((company) => (
            <li key={company.id}>
              <Card className="h-full">
                <CardContent className="flex h-full flex-col gap-3 p-5">
                  <div className="flex items-start gap-3">
                    <Building2
                      className="mt-0.5 size-5 shrink-0 text-[var(--muted-foreground)]"
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/companies/${company.id}`}
                        className="font-medium hover:underline"
                      >
                        {company.name}
                      </Link>
                      <p className="text-sm text-[var(--muted-foreground)]">
                        {t.companies.counts(
                          plural(company.locationCount, t.units.location, t.units.locations, locale),
                          plural(company.documentCount, t.units.document, t.units.documents, locale),
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="mt-auto flex flex-wrap items-center gap-2">
                    {company.isInternal && (
                      <span className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-xs">
                        {t.companies.internalBadge}
                      </span>
                    )}
                    {company.archivedAt && (
                      <>
                        <span className="rounded-full border px-2 py-0.5 text-xs text-[var(--muted-foreground)]">
                          {t.common.archived}
                        </span>
                        {canManageHierarchy(user.role) && (
                          <form action={unarchiveCompanyAction}>
                            <input type="hidden" name="id" value={company.id} />
                            <Button type="submit" variant="ghost" size="sm">
                              {t.common.restore}
                            </Button>
                          </form>
                        )}
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
