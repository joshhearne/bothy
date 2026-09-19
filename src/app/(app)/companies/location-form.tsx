"use client";

import { useEffect, useRef } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/alert";
import type { FormState } from "@/lib/form";
import { createLocationAction, updateLocationAction } from "./actions";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

/** Add form on the company page. Clears itself after each successful add. */
export function AddLocationForm({ companyId }: { companyId: string }) {
  const [state, formAction] = useActionState<FormState, FormData>(createLocationAction, {});
  const formRef = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const fieldErrors = state.fieldErrors ?? {};

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      nameRef.current?.focus();
    }
  }, [state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="flex flex-col gap-3 rounded-md border border-dashed p-4"
    >
      <FormError>{state.error}</FormError>
      <input type="hidden" name="companyId" value={companyId} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Field id="location-name" label="Location name" error={fieldErrors.name}>
            <Input
              ref={nameRef}
              id="location-name"
              name="name"
              placeholder="MOT1"
              required
              maxLength={200}
              aria-invalid={!!fieldErrors.name}
            />
          </Field>
        </div>
        <div className="flex-1">
          <Field id="location-address" label="Address" error={fieldErrors.address}>
            <Input id="location-address" name="address" placeholder="Optional" maxLength={2000} />
          </Field>
        </div>
        <SubmitButton label="Add location" />
      </div>
    </form>
  );
}

export function EditLocationForm({
  companyId,
  location,
}: {
  companyId: string;
  location: { id: string; name: string; address: string | null };
}) {
  const [state, formAction] = useActionState<FormState, FormData>(updateLocationAction, {});
  const fieldErrors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-5">
      <FormError>{state.error}</FormError>
      <input type="hidden" name="id" value={location.id} />
      <input type="hidden" name="companyId" value={companyId} />

      <Field id="name" label="Name" error={fieldErrors.name}>
        <Input
          id="name"
          name="name"
          defaultValue={location.name}
          required
          maxLength={200}
          autoFocus
          aria-invalid={!!fieldErrors.name}
        />
      </Field>

      <Field id="address" label="Address" error={fieldErrors.address}>
        <Input id="address" name="address" defaultValue={location.address ?? ""} maxLength={2000} />
      </Field>

      <div className="flex gap-2">
        <SubmitButton label="Save changes" />
      </div>
    </form>
  );
}
