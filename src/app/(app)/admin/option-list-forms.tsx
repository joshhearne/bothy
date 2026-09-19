"use client";

import { useEffect, useRef } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/alert";
import type { FormState } from "@/lib/form";
import { useMessages } from "@/i18n/client";
import { addOptionItemAction, createOptionListAction, renameOptionListAction } from "./actions";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  const t = useMessages();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? t.common.saving : label}
    </Button>
  );
}

export function CreateOptionListForm() {
  const [state, formAction] = useActionState<FormState, FormData>(createOptionListAction, {});
  const fieldErrors = state.fieldErrors ?? {};
  const t = useMessages();

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-4">
      <FormError>{state.error}</FormError>
      <Field id="name" label={t.admin.optionLists.listName} error={fieldErrors.name}>
        <Input id="name" name="name" required maxLength={200} aria-invalid={!!fieldErrors.name} />
      </Field>
      <div>
        <Submit label={t.admin.optionLists.create} />
      </div>
    </form>
  );
}

export function RenameOptionListForm({ list }: { list: { id: string; name: string } }) {
  const [state, formAction] = useActionState<FormState, FormData>(renameOptionListAction, {});
  const fieldErrors = state.fieldErrors ?? {};
  const t = useMessages();

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-4">
      <FormError>{state.error}</FormError>
      {state.ok && <p className="text-sm text-[var(--muted-foreground)]">{t.common.saved}</p>}
      <input type="hidden" name="id" value={list.id} />
      <Field id="name" label={t.admin.optionLists.listName} error={fieldErrors.name}>
        <Input
          id="name"
          name="name"
          defaultValue={list.name}
          required
          maxLength={200}
          aria-invalid={!!fieldErrors.name}
        />
      </Field>
      <div>
        <Submit label={t.admin.optionLists.saveName} />
      </div>
    </form>
  );
}

export function AddOptionItemForm({ listId }: { listId: string }) {
  const [state, formAction] = useActionState<FormState, FormData>(addOptionItemAction, {});
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fieldErrors = state.fieldErrors ?? {};
  const t = useMessages();

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      inputRef.current?.focus();
    }
  }, [state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="flex flex-col gap-3 rounded-md border border-dashed p-4 sm:flex-row sm:items-end"
    >
      <input type="hidden" name="listId" value={listId} />
      <div className="flex-1">
        <Field id="label" label={t.admin.optionLists.newOption} error={fieldErrors.label}>
          <Input
            ref={inputRef}
            id="label"
            name="label"
            required
            maxLength={200}
            aria-invalid={!!fieldErrors.label}
          />
        </Field>
      </div>
      <Submit label={t.admin.optionLists.addOption} />
    </form>
  );
}
