import { notFound, redirect } from "next/navigation";
import { canEditDocuments, requireUser } from "@/server/auth/session";
import { getCompany } from "@/server/services/companies";
import { getDocumentDetail } from "@/server/services/documents";
import { DocumentForm } from "../../document-form";

export const dynamic = "force-dynamic";

export default async function EditDocumentPage({
  params,
}: {
  params: Promise<{ documentId: string }>;
}) {
  const user = await requireUser();
  const { documentId } = await params;
  if (!canEditDocuments(user.role)) redirect(`/documents/${documentId}`);

  const detail = await getDocumentDetail(documentId);
  if (!detail) notFound();

  const company = await getCompany(detail.document.companyId);
  if (!company) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm text-[var(--muted-foreground)]">
          {company.name}
          {detail.location ? ` · ${detail.location.name}` : ""} · {detail.docType.name}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Edit {detail.document.title}</h1>
      </div>

      <DocumentForm
        mode="edit"
        submitLabel="Save document"
        documentId={detail.document.id}
        title={detail.document.title}
        values={detail.document.fieldValues ?? {}}
        options={Object.fromEntries(detail.optionIndex)}
        fields={detail.fields.map((field) => ({
          id: field.id,
          label: field.label,
          fieldType: field.fieldType,
          required: field.required,
          optionListId: field.optionListId,
          isLocal: field.documentId !== null,
        }))}
      />
    </div>
  );
}
