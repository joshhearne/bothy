"use client";

import Link from "next/link";
import type { Route } from "next";
import { useActionState, useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormError } from "@/components/ui/alert";
import { useMessages } from "@/i18n/client";
import type { FormState } from "@/lib/form";
import { deriveRunbook, RunbookStepError, type RunbookStep } from "@/server/kb/runbook";
import { saveArticleAction } from "./actions";

export type EditorValues = {
  collectionId: string;
  /** Set when editing; the article keeps its name across saves. */
  externalId?: string;
  title: string;
  category: string;
  subcategory: string;
  kind: "article" | "runbook";
  internalOnly: boolean;
  body: string;
  steps: RunbookStep[];
  /** Came from an import, so the next import of it wins. */
  imported: boolean;
};

/**
 * The Markdown editor for a knowledge base article: the same fields a key
 * writes through the API, and for a runbook the steps as a save would keep
 * them, read from the body as it is typed.
 */
export function KbEditor({ values, backHref }: { values: EditorValues; backHref: string }) {
  const t = useMessages().kb.editor;
  const ids = { title: useId(), category: useId(), subcategory: useId(), body: useId() };
  const [body, setBody] = useState(values.body);
  const [runbook, setRunbook] = useState(values.kind === "runbook");
  const [state, formAction, pending] = useActionState<FormState, FormData>(saveArticleAction, {});

  const preview = useMemo(() => {
    if (!runbook) return null;
    try {
      return { steps: deriveRunbook(body, values.steps).steps, error: null };
    } catch (error) {
      return { steps: [], error: error instanceof RunbookStepError ? error.message : String(error) };
    }
  }, [runbook, body, values.steps]);

  return (
    <form action={formAction} className="flex max-w-4xl flex-col gap-5">
      <input type="hidden" name="collectionId" value={values.collectionId} />
      {values.externalId && <input type="hidden" name="externalId" value={values.externalId} />}

      {values.imported && (
        <p role="note" className="rounded-md border px-3 py-2 text-sm text-[var(--muted-foreground)]">
          {t.importedNote}
        </p>
      )}

      <Field id={ids.title} label={t.title} error={state.fieldErrors?.title}>
        <Input id={ids.title} name="title" defaultValue={values.title} required maxLength={500} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={ids.category} label={t.category} error={state.fieldErrors?.category}>
          <Input id={ids.category} name="category" defaultValue={values.category} maxLength={200} />
        </Field>
        <Field id={ids.subcategory} label={t.subcategory} error={state.fieldErrors?.subcategory}>
          <Input id={ids.subcategory} name="subcategory" defaultValue={values.subcategory} maxLength={200} />
        </Field>
      </div>

      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          name="runbook"
          checked={runbook}
          onChange={(event) => setRunbook(event.target.checked)}
          className="mt-0.5 size-4 accent-[var(--primary)]"
        />
        <span>
          <span className="block font-medium">{t.runbook}</span>
          <span className="block text-xs text-[var(--muted-foreground)]">{t.runbookHint}</span>
        </span>
      </label>

      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          name="internalOnly"
          defaultChecked={values.internalOnly}
          className="mt-0.5 size-4 accent-[var(--primary)]"
        />
        <span>
          <span className="block font-medium">{t.internalOnly}</span>
          <span className="block text-xs text-[var(--muted-foreground)]">{t.internalOnlyHint}</span>
        </span>
      </label>

      <Field id={ids.body} label={t.body} hint={t.bodyHint} error={state.fieldErrors?.body ?? preview?.error ?? undefined}>
        <Textarea
          id={ids.body}
          name="body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          spellCheck
          className="min-h-96 font-mono text-sm"
          aria-invalid={!!state.fieldErrors?.body || !!preview?.error}
        />
      </Field>

      {preview && (
        <section aria-label={t.stepsPreview} className="rounded-md border px-4 py-3">
          <h2 className="text-sm font-medium">{t.stepsPreview}</h2>
          {preview.steps.length === 0 ? (
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">{t.noSteps}</p>
          ) : (
            <ol className="mt-2 flex flex-col gap-1 text-sm">
              {preview.steps.map((step, index) => (
                <li key={step.id} className="flex gap-2">
                  <span className="shrink-0 tabular-nums text-[var(--muted-foreground)]">{index + 1}.</span>
                  <span className="min-w-0 flex-1 break-words">
                    {step.text}{" "}
                    <code className="text-xs text-[var(--muted-foreground)]">{`{#${step.id}}`}</code>
                    {step.note && (
                      <span className="block text-xs text-[var(--muted-foreground)]">
                        {t.stepNote}: {step.note.split("\n")[0]}
                        {step.note.includes("\n") ? "…" : ""}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      <FormError>{state.error}</FormError>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending || !!preview?.error}>
          {t.save}
        </Button>
        <Link href={backHref as Route} className="text-sm underline">
          {t.cancel}
        </Link>
      </div>
    </form>
  );
}
