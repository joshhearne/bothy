import Link from "next/link";
import { Building2, Plus } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { plural } from "@/lib/utils";
import { canManageHierarchy, requireUser } from "@/server/auth/session";
import { listCompanies } from "@/server/services/companies";
import { unarchiveCompanyAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const user = await requireUser();
  const { archived } = await searchParams;
  const showArchived = archived === "1";
  const companies = await listCompanies({ includeArchived: showArchived });
  const writer = canManageHierarchy(user.role);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Companies</h1>
        <div className="flex items-center gap-2">
          <Link
            href={showArchived ? "/companies" : { pathname: "/companies", query: { archived: "1" } }}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            {showArchived ? "Hide archived" : "Show archived"}
          </Link>
          {writer && (
            <Link
              href="/companies/new"
              className={buttonVariants({ size: "sm" })}
            >
              <Plus className="size-4" aria-hidden />
              New company
            </Link>
          )}
        </div>
      </div>

      {companies.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-3 p-6">
            <p className="text-sm text-[var(--muted-foreground)]">
              No companies yet. Create one to start documenting.
            </p>
            {writer && (
              <Link
                href="/companies/new"
                className={buttonVariants({ size: "sm" })}
              >
                <Plus className="size-4" aria-hidden />
                New company
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
                        {`${plural(company.locationCount, "location")} · ${plural(company.documentCount, "document")}`}
                      </p>
                    </div>
                  </div>

                  <div className="mt-auto flex flex-wrap items-center gap-2">
                    {company.isInternal && (
                      <span className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-xs">
                        Internal
                      </span>
                    )}
                    {company.archivedAt && (
                      <>
                        <span className="rounded-full border px-2 py-0.5 text-xs text-[var(--muted-foreground)]">
                          Archived
                        </span>
                        {canManageHierarchy(user.role) && (
                          <form action={unarchiveCompanyAction}>
                            <input type="hidden" name="id" value={company.id} />
                            <Button type="submit" variant="ghost" size="sm">
                              Restore
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
