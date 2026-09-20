"use client";

import { useEffect, useRef } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/alert";
import type { FormState } from "@/lib/form";
import { useMessages } from "@/i18n/client";
import { addAttachmentAction } from "./actions";

function Submit() {
  const { pending } = useFormStatus();
  const t = useMessages();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? t.documents.uploading : t.documents.upload}
    </Button>
  );
}

export function AttachmentUpload({
  documentId,
  maxMb,
  accept,
}: {
  documentId: string;
  maxMb: number;
  accept: string;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(addAttachmentAction, {});
  const formRef = useRef<HTMLFormElement>(null);
  const t = useMessages();

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="flex flex-col gap-3 rounded-md border border-dashed p-4"
    >
      <FormError>{state.error}</FormError>
      <input type="hidden" name="documentId" value={documentId} />

      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="attachment-file" className="text-sm font-medium">
          {t.documents.addFile}
        </label>
        <input
          id="attachment-file"
          type="file"
          name="file"
          accept={accept}
          required
          className="flex-1 text-sm file:mr-3 file:rounded-md file:border file:border-[var(--border)] file:bg-transparent file:px-3 file:py-1.5 file:text-sm file:text-[var(--foreground)] hover:file:bg-[var(--muted)]"
        />
        <Submit />
      </div>
      <p className="text-xs text-[var(--muted-foreground)]">
        {t.documents.uploadLimit(maxMb)} {t.documents.uploadTypes}
      </p>
    </form>
  );
}
