import Link from "next/link";
import { notFound } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { FieldValue } from "@/components/fields/field-value";
import { canEditDocuments, requireUser } from "@/server/auth/session";
import { getCompany } from "@/server/services/companies";
import { getDocumentDetail } from "@/server/services/documents";
import { formatDateTime, renderFieldValue } from "@/server/fields/render";
import { archiveDocumentAction, unarchiveDocumentAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ documentId: string }>;
}) {
  const user = await requireUser();
  const { documentId } = await params;

  const detail = await getDocumentDetail(documentId);
  if (!detail) notFound();

  const company = await getCompany(detail.document.companyId);
  if (!company) notFound();

  const editor = canEditDocuments(user.role);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-[var(--muted-foreground)]">
            <Link href={`/companies/${company.id}`} className="hover:underline">
              {company.name}
            </Link>
            {detail.location ? ` · ${detail.location.name}` : ""} · {detail.docType.name}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{detail.document.title}</h1>
            {detail.document.archivedAt && (
              <span className="rounded-full border px-2 py-0.5 text-xs text-[var(--muted-foreground)]">
                Archived
              </span>
            )}
          </div>
          <p className="text-sm text-[var(--muted-foreground)]">
            Updated {formatDateTime(detail.document.updatedAt)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/documents/${detail.document.id}/revisions`}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            History
          </Link>
          {editor && !detail.document.archivedAt && (
            <Link
              href={`/documents/${detail.document.id}/edit`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Edit
            </Link>
          )}
          {editor &&
            (detail.document.archivedAt ? (
              <form action={unarchiveDocumentAction}>
                <input type="hidden" name="documentId" value={detail.document.id} />
                <input type="hidden" name="companyId" value={company.id} />
                <Button type="submit" variant="outline" size="sm">
                  Restore
                </Button>
              </form>
            ) : (
              <form action={archiveDocumentAction}>
                <input type="hidden" name="documentId" value={detail.document.id} />
                <input type="hidden" name="companyId" value={company.id} />
                <Button type="submit" variant="outline" size="sm">
                  Archive
                </Button>
              </form>
            ))}
        </div>
      </div>

      {detail.fields.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">
          This doc type has no fields yet.
        </p>
      ) : (
        <dl className="flex flex-col divide-y rounded-md border">
          {detail.fields.map((field) => (
            <div key={field.id} className="grid gap-1 px-4 py-3 sm:grid-cols-[14rem_1fr] sm:gap-4">
              <dt className="text-sm font-medium text-[var(--muted-foreground)]">{field.label}</dt>
              <dd className="min-w-0">
                <FieldValue
                  value={renderFieldValue(
                    field,
                    detail.document.fieldValues?.[field.id] ?? null,
                    detail.optionLabels,
                  )}
                />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
