import { FIELD_TYPES } from "@/server/db/schema";

export type FieldType = (typeof FIELD_TYPES)[number];

/**
 * doc_link lands in Phase 4 and secret_ref in Phase 6, so the editor and the
 * doc type admin only offer the rest for now.
 */
export const UNSUPPORTED_FIELD_TYPES = ["doc_link", "secret_ref"] as const satisfies FieldType[];

export const EDITABLE_FIELD_TYPES = FIELD_TYPES.filter(
  (type): type is Exclude<FieldType, "doc_link" | "secret_ref"> =>
    !(UNSUPPORTED_FIELD_TYPES as readonly string[]).includes(type),
);

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: "Text",
  markdown: "Markdown",
  richtext: "Rich text",
  number: "Number",
  date: "Date",
  url: "URL",
  ip: "IP address",
  boolean: "Yes / no",
  dropdown: "Dropdown",
  multi_dropdown: "Multi-select dropdown",
  doc_link: "Link to document",
  secret_ref: "Secret",
};

/** Dropdown types are the ones that need an option list attached. */
export function usesOptionList(type: FieldType): boolean {
  return type === "dropdown" || type === "multi_dropdown";
}

export function isEditableType(type: FieldType): boolean {
  return !(UNSUPPORTED_FIELD_TYPES as readonly string[]).includes(type);
}

/** The shape every value function needs about the field it is handling. */
export type FieldDefinition = {
  id: string;
  label: string;
  fieldType: FieldType;
  optionListId: string | null;
  required: boolean;
  sortOrder: number;
  archivedAt: Date | null;
  docTypeId: string | null;
  documentId: string | null;
};
