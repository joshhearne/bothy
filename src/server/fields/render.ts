import "server-only";
import { marked } from "marked";
import { sanitizeRichText } from "@/server/fields/sanitize";
import type { FieldDefinition } from "@/server/fields/types";

marked.setOptions({ gfm: true, breaks: false });

/** Markdown source to safe HTML. Rendered output goes through the same allowlist. */
export function renderMarkdown(source: string): string {
  return sanitizeRichText(marked.parse(source, { async: false }));
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeZone: "UTC",
});

const DATE_TIME_FORMAT = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

/** ISO date string (YYYY-MM-DD) in en-US, with no timezone drift. */
export function formatDate(iso: string): string {
  const parsed = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? iso : DATE_FORMAT.format(parsed);
}

export function formatDateTime(date: Date): string {
  return DATE_TIME_FORMAT.format(date);
}

export type RenderedValue =
  | { kind: "empty" }
  | { kind: "text"; text: string }
  | { kind: "url"; href: string }
  | { kind: "html"; html: string }
  | { kind: "tags"; labels: string[] };

/**
 * Turns a stored value into what the view page should show. Option ids become
 * labels, markdown becomes HTML, and anything unknown falls back to text.
 */
export function renderFieldValue(
  field: FieldDefinition,
  value: unknown,
  optionLabels: Map<string, string>,
): RenderedValue {
  if (value === null || value === undefined || value === "") return { kind: "empty" };

  switch (field.fieldType) {
    case "markdown":
      return { kind: "html", html: renderMarkdown(String(value)) };

    case "richtext":
      // Stored sanitized; sanitized again here so older rows cannot bite us.
      return { kind: "html", html: sanitizeRichText(String(value)) };

    case "url":
      return { kind: "url", href: String(value) };

    case "boolean":
      return { kind: "text", text: value === true ? "Yes" : "No" };

    case "date":
      return { kind: "text", text: formatDate(String(value)) };

    case "number":
      return { kind: "text", text: new Intl.NumberFormat("en-US").format(Number(value)) };

    case "dropdown": {
      const label = optionLabels.get(String(value));
      return label ? { kind: "text", text: label } : { kind: "empty" };
    }

    case "multi_dropdown": {
      if (!Array.isArray(value) || value.length === 0) return { kind: "empty" };
      const labels = value
        .map((id) => optionLabels.get(String(id)))
        .filter((label): label is string => !!label);
      return labels.length > 0 ? { kind: "tags", labels } : { kind: "empty" };
    }

    case "doc_link":
    case "secret_ref":
      // Phase 4 and Phase 6 own these; never guess at rendering a secret.
      return { kind: "empty" };

    default:
      return { kind: "text", text: String(value) };
  }
}
