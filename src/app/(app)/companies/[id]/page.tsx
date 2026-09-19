import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText, MapPin } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { plural } from "@/lib/utils";
import { canArchive, canWrite, requireUser } from "@/server/auth/session";
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
  const user = await requireUser();
  const { id } = await params;
  const { archived } = await searchParams;
  const showArchived = archived === "1";

  const company = await getCompany(id);
  if (!company) notFound();

  const [locations, documentGroups] = await Promise.all([
    listLocations(id, { includeArchived: showArchived }),
    listCompanyDocumentsGrouped(id),
  ]);

  const writer = canWrite(user.role);
  const archiver = canArchive(user.role);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{company.name}</h1>
            {company.isInternal && (
              <span className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-xs">Internal</span>
            )}
            {company.archivedAt && (
              <span className="rounded-full border px-2 py-0.5 text-xs text-[var(--muted-foreground)]">
                Archived
              </span>
            )}
          </div>
          <p className="text-sm text-[var(--muted-foreground)]">
            {plural(locations.length, "location")}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {writer && (
            <Link
              href={`/companies/${company.id}/edit`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Edit
            </Link>
          )}
          {archiver &&
            (company.archivedAt ? (
              <form action={unarchiveCompanyAction}>
                <input type="hidden" name="id" value={company.id} />
                <Button type="submit" variant="outline" size="sm">
                  Restore
                </Button>
              </form>
            ) : (
              <form action={archiveCompanyAction}>
                <input type="hidden" name="id" value={company.id} />
                <Button type="submit" variant="outline" size="sm">
                  Archive
                </Button>
              </form>
            ))}
        </div>
      </div>

      {company.notes && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm">{company.notes}</p>
          </CardContent>
        </Card>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold tracking-tight">Locations</h2>
          <Link
            href={
              showArchived
                ? `/companies/${company.id}`
                : { pathname: `/companies/${company.id}`, query: { archived: "1" } }
            }
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            {showArchived ? "Hide archived" : "Show archived"}
          </Link>
        </div>

        {locations.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">No locations yet.</p>
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
                        Archived
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
                  {plural(location.documentCount, "document")}
                </span>
                {writer && (
                  <Link
                    href={`/companies/${company.id}/locations/${location.id}/edit`}
                    className={buttonVariants({ variant: "ghost", size: "sm" })}
                  >
                    Edit
                  </Link>
                )}
                {archiver &&
                  (location.archivedAt ? (
                    <form action={unarchiveLocationAction}>
                      <input type="hidden" name="id" value={location.id} />
                      <input type="hidden" name="companyId" value={company.id} />
                      <Button type="submit" variant="ghost" size="sm">
                        Restore
                      </Button>
                    </form>
                  ) : (
                    <form action={archiveLocationAction}>
                      <input type="hidden" name="id" value={location.id} />
                      <input type="hidden" name="companyId" value={company.id} />
                      <Button type="submit" variant="ghost" size="sm">
                        Archive
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
        <h2 className="text-lg font-semibold tracking-tight">Documents</h2>

        {documentGroups.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">
            No documents yet. Doc types and documents arrive in Phase 2.
          </p>
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
                      <span className="min-w-0 flex-1 truncate font-medium">{document.title}</span>
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
