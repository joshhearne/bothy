import { notFound, redirect } from "next/navigation";
import { canEditDocuments, canManageDocTypes, requireUser } from "@/server/auth/session";
import { getCompany } from "@/server/services/companies";
import { getDocumentDetail } from "@/server/services/documents";
import { listOptionLists } from "@/server/services/option-lists";
import {
  EDITABLE_FIELD_TYPES,
  FIELD_TYPE_LABELS,
  usesLinkDocType,
  usesOptionList,
} from "@/server/fields/types";
import { listDocTypes } from "@/server/services/doc-types";
import { getMessages } from "@/i18n/server";
import { DocumentEditor } from "./document-editor";

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

  const [optionLists, docTypes] = await Promise.all([listOptionLists(), listDocTypes()]);
  const t = await getMessages();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm text-[var(--muted-foreground)]">
          {company.name}
          {detail.location ? ` · ${detail.location.name}` : ""} · {detail.docType.name}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t.documents.editHeading(detail.document.title)}
        </h1>
      </div>

      <DocumentEditor
        documentId={detail.document.id}
        docTypeId={detail.docType.id}
        docTypeName={detail.docType.name}
        initialTitle={detail.document.title}
        initialValues={detail.document.fieldValues ?? {}}
        initialOptions={Object.fromEntries(detail.optionIndex)}
        canManageTemplate={canManageDocTypes(user.role)}
        optionLists={optionLists.map((list) => ({ id: list.id, name: list.name }))}
        docTypeChoices={docTypes.map((docType) => ({ id: docType.id, name: docType.name }))}
        linkTargets={Object.fromEntries(
          [...detail.linkTargets].map(([fieldId, targets]) => [
            fieldId,
            [...targets].map(([id, label]) => ({ id, label })),
          ]),
        )}
        secretItems={Object.fromEntries(
          [...detail.secretItems].map(([fieldId, items]) => [
            fieldId,
            [...items].map(([id, ref]) => ({
              id,
              label: String((ref as { label?: unknown }).label ?? id),
            })),
          ]),
        )}
        fieldTypes={EDITABLE_FIELD_TYPES.map((value) => ({
          value,
          label: FIELD_TYPE_LABELS[value],
          usesOptionList: usesOptionList(value),
          usesLinkDocType: usesLinkDocType(value),
        }))}
        initialFields={detail.fields.map((field) => ({
          id: field.id,
          label: field.label,
          fieldType: field.fieldType,
          required: field.required,
          optionListId: field.optionListId,
          linkDocTypeId: field.linkDocTypeId,
          isLocal: field.documentId !== null,
        }))}
      />
    </div>
  );
}
