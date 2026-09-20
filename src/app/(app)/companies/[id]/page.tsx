import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText, MapPin } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  canEditDocuments,
  canManageHierarchy,
  requireScopedUser,
} from "@/server/auth/session";
import { getI18n } from "@/i18n/server";
import { plural } from "@/i18n/format";
import { getCompany } from "@/server/services/companies";
import { listLocations } from "@/server/services/locations";
import { listCompanyDocumentsGrouped } from "@/server/services/documents";
import { AddLocationForm } from "../location-form";
import {
  archiveCompanyAction,
  archiveLocationAction,
  unarchiveCompanyAction,
  unarchiveLocationAction,
} from "../actions";

export const dynamic = "force-dynamic";

export default async function CompanyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ archived?: string }>;
}) {
  const { user, scope } = await requireScopedUser();
  const { id } = await params;
  const { archived } = await searchParams;
  const showArchived = archived === "1";

  const company = await getCompany(id, scope);
  if (!company) notFound();

  const [locations, documentGroups] = await Promise.all([
    listLocations(id, scope, { includeArchived: showArchived }),
    listCompanyDocumentsGrouped(id, scope),
  ]);

  const { locale, messages: t } = await getI18n();
  const writer = canManageHierarchy(user.role);
  const documentEditor = canEditDocuments(user.role);
  const archiver = writer;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{company.name}</h1>
            {company.isInternal && (
              <span className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-xs">
                {t.companies.internalBadge}
              </span>
            )}
            {company.archivedAt && (
              <span className="rounded-full border px-2 py-0.5 text-xs text-[var(--muted-foreground)]">
                {t.common.archived}
              </span>
            )}
          </div>
          <p className="text-sm text-[var(--muted-foreground)]">
            {plural(locations.length, t.units.location, t.units.locations, locale)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`/companies/${company.id}/export`}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
            download
          >
            {t.companies.exportJson}
          </a>
          <a
            href={`/companies/${company.id}/export?format=markdown`}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
            download
          >
            {t.companies.exportMarkdown}
          </a>
          {writer && (
            <Link
              href={`/companies/${company.id}/edit`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              {t.common.edit}
            </Link>
          )}
          {archiver &&
            (company.archivedAt ? (
              <form action={unarchiveCompanyAction}>
                <input type="hidden" name="id" value={company.id} />
                <Button type="submit" variant="outline" size="sm">
                  {t.common.restore}
                </Button>
              </form>
            ) : (
              <form action={archiveCompanyAction}>
                <input type="hidden" name="id" value={company.id} />
                <Button type="submit" variant="outline" size="sm">
                  {t.common.archive}
                </Button>
              </form>
            ))}
        </div>
      </div>

      {company.notes && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t.common.notes}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm">{company.notes}</p>
          </CardContent>
        </Card>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold tracking-tight">{t.companies.locations}</h2>
          <Link
            href={
              showArchived
                ? `/companies/${company.id}`
                : { pathname: `/companies/${company.id}`, query: { archived: "1" } }
            }
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            {showArchived ? t.common.hideArchived : t.common.showArchived}
          </Link>
        </div>

        {locations.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">{t.companies.noLocations}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {locations.map((location) => (
              <li
                key={location.id}
                className="flex flex-wrap items-center gap-3 rounded-md border px-4 py-3"
              >
                <MapPin className="size-4 shrink-0 text-[var(--muted-foreground)]" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {location.name}
                    {location.archivedAt && (
                      <span className="ml-2 rounded-full border px-2 py-0.5 text-xs font-normal text-[var(--muted-foreground)]">
                        {t.common.archived}
                      </span>
                    )}
                  </p>
                  {location.address && (
                    <p className="truncate text-sm text-[var(--muted-foreground)]">
                      {location.address}
                    </p>
                  )}
                </div>
                <span className="text-sm text-[var(--muted-foreground)]">
                  {plural(location.documentCount, t.units.document, t.units.documents, locale)}
                </span>
                {writer && (
                  <Link
                    href={`/companies/${company.id}/locations/${location.id}/edit`}
                    className={buttonVariants({ variant: "ghost", size: "sm" })}
                  >
                    {t.common.edit}
                  </Link>
                )}
                {archiver &&
                  (location.archivedAt ? (
                    <form action={unarchiveLocationAction}>
                      <input type="hidden" name="id" value={location.id} />
                      <input type="hidden" name="companyId" value={company.id} />
                      <Button type="submit" variant="ghost" size="sm">
                        {t.common.restore}
                      </Button>
                    </form>
                  ) : (
                    <form action={archiveLocationAction}>
                      <input type="hidden" name="id" value={location.id} />
                      <input type="hidden" name="companyId" value={company.id} />
                      <Button type="submit" variant="ghost" size="sm">
                        {t.common.archive}
                      </Button>
                    </form>
                  ))}
              </li>
            ))}
          </ul>
        )}

        {writer && !company.archivedAt && <AddLocationForm companyId={company.id} />}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold tracking-tight">{t.companies.documents}</h2>
          {documentEditor && !company.archivedAt && (
            <Link
              href={`/companies/${company.id}/documents/new`}
              className={buttonVariants({ size: "sm" })}
            >
              {t.companies.newDocument}
            </Link>
          )}
        </div>

        {documentGroups.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">{t.companies.noDocuments}</p>
        ) : (
          <div className="flex flex-col gap-5">
            {documentGroups.map((group) => (
              <div key={group.docType.id} className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                  {group.docType.name}
                </h3>
                <ul className="flex flex-col gap-2">
                  {group.documents.map((document) => (
                    <li
                      key={document.id}
                      className="flex items-center gap-3 rounded-md border px-4 py-3"
                    >
                      <FileText
                        className="size-4 shrink-0 text-[var(--muted-foreground)]"
                        aria-hidden
                      />
                      <Link
                        href={`/documents/${document.id}`}
                        className="min-w-0 flex-1 truncate font-medium hover:underline"
                      >
                        {document.title}
                      </Link>
                      {document.locationName && (
                        <span className="text-sm text-[var(--muted-foreground)]">
                          {document.locationName}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
