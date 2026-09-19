import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { FieldValue } from "@/components/fields/field-value";
import { requireUser } from "@/server/auth/session";
import { getDocumentDetail, listRevisions } from "@/server/services/documents";
import { formatDateTime, renderFieldValue } from "@/server/fields/render";

export const dynamic = "force-dynamic";

export default async function RevisionsPage({
  params,
}: {
  params: Promise<{ documentId: string }>;
}) {
  await requireUser();
  const { documentId } = await params;

  const detail = await getDocumentDetail(documentId);
  if (!detail) notFound();

  const revisions = await listRevisions(documentId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">History</h1>
          <p className="text-sm text-[var(--muted-foreground)]">{detail.document.title}</p>
        </div>
        <Link
          href={`/documents/${documentId}`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          Back to document
        </Link>
      </div>

      {revisions.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">No revisions recorded.</p>
      ) : (
        <ol className="flex flex-col gap-4">
          {revisions.map((revision, index) => (
            <li key={revision.id} className="rounded-md border">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
                <span className="text-sm font-medium">{revision.title}</span>
                <span className="text-sm text-[var(--muted-foreground)]">
                  {formatDateTime(revision.createdAt)}
                  {index === 0 ? " · current" : ""}
                </span>
              </div>
              <dl className="flex flex-col divide-y">
                {detail.fields.map((field) => (
                  <div
                    key={field.id}
                    className="grid gap-1 px-4 py-2 sm:grid-cols-[14rem_1fr] sm:gap-4"
                  >
                    <dt className="text-sm text-[var(--muted-foreground)]">{field.label}</dt>
                    <dd className="min-w-0">
                      <FieldValue
                        value={renderFieldValue(
                          field,
                          revision.fieldValues?.[field.id] ?? null,
                          detail.optionLabels,
                        )}
                      />
                    </dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
