import { z } from "zod";
import { sanitizeRichText, htmlToText } from "@/server/fields/sanitize";
import type { FieldDefinition, FieldType } from "@/server/fields/types";

/** Option items available to a dropdown field, keyed by option list id. */
export type OptionIndex = Map<string, { id: string; label: string }[]>;

/** Documents a doc_link field may point at: field id -> (document id -> title). */
export type LinkTargetIndex = Map<string, Map<string, string>>;

/** Everything validation needs from the database, resolved once per save. */
export type ValidationContext = {
  options?: OptionIndex;
  linkTargets?: LinkTargetIndex;
};

const MAX_TEXT = 10_000;
const MAX_LONG_TEXT = 200_000;

const uuid = z.uuid();

function baseSchema(field: FieldDefinition, ctx: ValidationContext): z.ZodType {
  const options: OptionIndex = ctx.options ?? new Map();
  const allowed = field.optionListId ? (options.get(field.optionListId) ?? []) : [];
  const allowedIds = new Set(allowed.map((o) => o.id));

  switch (field.fieldType) {
    case "text":
      return z.string().trim().max(MAX_TEXT);
    case "markdown":
      return z.string().max(MAX_LONG_TEXT);
    case "richtext":
      return z
        .string()
        .max(MAX_LONG_TEXT)
        .transform((html) => sanitizeRichText(html));
    case "number":
      return z.number({ error: "Enter a number" }).finite();
    case "date":
      return z.iso.date("Enter a date as YYYY-MM-DD");
    case "url":
      return z.url({ protocol: /^https?$/, error: "Enter an http or https URL" }).max(2_000);
    case "ip":
      return z.union([z.ipv4(), z.ipv6()], { error: "Enter an IPv4 or IPv6 address" });
    case "boolean":
      return z.boolean();
    case "dropdown":
      return uuid.refine((id) => allowedIds.has(id), "Choose one of the listed options");
    case "multi_dropdown":
      return z
        .array(uuid.refine((id) => allowedIds.has(id), "Choose from the listed options"))
        .refine((ids) => new Set(ids).size === ids.length, "Each option can only be chosen once");
    case "doc_link": {
      // Only documents the field is allowed to reach: same company, and the
      // right doc type when the field names one.
      const targets = ctx.linkTargets?.get(field.id);
      return uuid.refine(
        (id) => targets?.has(id) ?? false,
        "Choose one of the documents offered",
      );
    }

    case "secret_ref":
      // Phase 6. Reject rather than store something unvalidated.
      return z.never({ error: "This field type cannot be edited yet" });
  }
}

/** True when a submitted value counts as "left blank". */
export function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

export type FieldValidationResult =
  | { ok: true; value: unknown }
  | { ok: false; message: string };

/** Validates one raw value against its field, sanitizing richtext on the way through. */
export function validateFieldValue(
  field: FieldDefinition,
  raw: unknown,
  ctx: ValidationContext = {},
): FieldValidationResult {
  if (isEmptyValue(raw)) {
    if (field.required) return { ok: false, message: `${field.label} is required` };
    return { ok: true, value: null };
  }

  const parsed = baseSchema(field, ctx).safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid value" };
  }

  // Sanitizing can empty a richtext value entirely; treat that as blank.
  if (isEmptyValue(parsed.data)) {
    if (field.required) return { ok: false, message: `${field.label} is required` };
    return { ok: true, value: null };
  }

  return { ok: true, value: parsed.data };
}

export type FieldValuesResult = {
  values: Record<string, unknown>;
  errors: Record<string, string>;
};

/**
 * Validates a partial map of raw values keyed by field UUID. Fields absent from
 * `raw` are left untouched, which is what `PATCH /documents/:id` needs; fields
 * present with an empty value are cleared.
 */
export function validateFieldValues(
  fields: FieldDefinition[],
  raw: Record<string, unknown>,
  ctx: ValidationContext = {},
): FieldValuesResult {
  const values: Record<string, unknown> = {};
  const errors: Record<string, string> = {};

  for (const field of fields) {
    if (!(field.id in raw)) continue;
    if (field.archivedAt) continue; // archived fields keep their stored value

    const result = validateFieldValue(field, raw[field.id], ctx);
    if (result.ok) {
      values[field.id] = result.value;
    } else {
      errors[field.id] = result.message;
    }
  }

  return { values, errors };
}

/** Merges validated values over the stored ones, dropping cleared fields. */
export function mergeFieldValues(
  stored: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...stored };
  for (const [fieldId, value] of Object.entries(incoming)) {
    if (value === null) delete merged[fieldId];
    else merged[fieldId] = value;
  }
  return merged;
}

/** Flattens values to the plain text that backs `documents.search_text`. */
export function flattenForSearch(
  fields: FieldDefinition[],
  values: Record<string, unknown>,
  ctx: ValidationContext = {},
): string {
  const options: OptionIndex = ctx.options ?? new Map();
  const labelFor = (optionListId: string | null, id: unknown): string => {
    if (!optionListId || typeof id !== "string") return "";
    return options.get(optionListId)?.find((o) => o.id === id)?.label ?? "";
  };

  const parts: string[] = [];

  for (const field of fields) {
    const value = values[field.id];
    if (isEmptyValue(value)) continue;

    switch (field.fieldType) {
      case "richtext":
        parts.push(htmlToText(String(value)));
        break;
      case "dropdown":
        parts.push(labelFor(field.optionListId, value));
        break;
      case "multi_dropdown":
        if (Array.isArray(value)) {
          for (const id of value) parts.push(labelFor(field.optionListId, id));
        }
        break;
      case "boolean":
        parts.push(value === true ? field.label : "");
        break;
      case "doc_link": {
        // Index the linked document's title, not its UUID.
        const title = ctx.linkTargets?.get(field.id)?.get(String(value));
        if (title) parts.push(title);
        break;
      }

      case "secret_ref":
        // Never indexed: secrets stay out of search entirely (CLAUDE.md).
        break;
      default:
        parts.push(String(value));
    }
  }

  return parts
    .filter((part) => part.trim() !== "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export type { FieldType };
