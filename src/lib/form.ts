import type { ZodError } from "zod";

export type FormState = {
  /** Set on a successful submit so a form can clear itself. */
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
};

/** First message per field, which is all the forms render. */
export function toFieldErrors(error: ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return fieldErrors;
}

/** Reads a form value as a trimmed string, or undefined when absent/empty. */
export function text(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function checkbox(formData: FormData, key: string): boolean {
  return formData.get(key) != null;
}
