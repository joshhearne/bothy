"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/alert";
import { useMessages } from "@/i18n/client";
import type { FormState } from "@/lib/form";
import { applyDocTypeScheduleAction, saveDocTypeScheduleAction } from "./schedule-actions";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  const t = useMessages();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? t.common.saving : label}
    </Button>
  );
}

/** The schedule every document of this type is born with. */
export function DocTypeScheduleForm({
  docTypeId,
  kind,
  dueDays,
  intervalDays,
  leadDays,
}: {
  docTypeId: string;
  kind: string | null;
  dueDays: number | null;
  intervalDays: number | null;
  leadDays: number | null;
}) {
  const t = useMessages();
  const [state, formAction] = useActionState<FormState, FormData>(saveDocTypeScheduleAction, {});
  const [applied, applyAction] = useActionState<FormState & { stamped?: number }, FormData>(
    applyDocTypeScheduleAction,
    {},
  );
  const [chosen, setChosen] = useState(kind ?? "none");

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">
          {t.documents.schedule.typeHeading}
        </h2>
        <p className="text-sm text-[var(--muted-foreground)]">{t.documents.schedule.typeHint}</p>
      </div>

      <form action={formAction} className="flex max-w-xl flex-col gap-3">
        <FormError>{state.error}</FormError>
        <input type="hidden" name="docTypeId" value={docTypeId} />

        <Field id="scheduleKind" label={t.documents.schedule.typeKind}>
          <select
            id="scheduleKind"
            name="kind"
            defaultValue={chosen}
            onChange={(event) => setChosen(event.target.value)}
            className="h-10 w-full rounded-md border bg-transparent px-3 text-sm"
          >
            <option value="none">{t.documents.schedule.typeNone}</option>
            <option value="expiry">{t.documents.schedule.expiry}</option>
            <option value="maintenance">{t.documents.schedule.maintenance}</option>
          </select>
        </Field>

        {chosen !== "none" && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field
              id="dueDays"
              label={t.documents.schedule.typeDueDays}
              error={state.fieldErrors?.dueDays}
            >
              <Input
                id="dueDays"
                name="dueDays"
                type="number"
                min={1}
                max={3650}
                defaultValue={dueDays ?? 365}
              />
            </Field>

            {chosen === "maintenance" && (
              <Field
                id="typeInterval"
                label={t.documents.schedule.typeInterval}
                error={state.fieldErrors?.intervalDays}
              >
                <Input
                  id="typeInterval"
                  name="intervalDays"
                  type="number"
                  min={1}
                  max={3650}
                  defaultValue={intervalDays ?? 365}
                />
              </Field>
            )}

            <Field id="typeLead" label={t.documents.schedule.typeLead}>
              <Input
                id="typeLead"
                name="leadDays"
                type="number"
                min={0}
                max={365}
                defaultValue={leadDays ?? 30}
              />
            </Field>
          </div>
        )}

        <div>
          <Submit label={t.documents.schedule.typeSave} />
        </div>
      </form>

      {kind && (
        <form action={applyAction} className="flex flex-col gap-2">
          <input type="hidden" name="docTypeId" value={docTypeId} />
          <p className="text-xs text-[var(--muted-foreground)]">
            {t.documents.schedule.typeApplyHint}
          </p>
          <div className="flex items-center gap-3">
            <Button type="submit" variant="outline" size="sm">
              {t.documents.schedule.typeApply}
            </Button>
            {applied.stamped !== undefined && (
              <span className="text-sm text-[var(--muted-foreground)]">
                {t.documents.schedule.typeApplied(applied.stamped)}
              </span>
            )}
          </div>
        </form>
      )}
    </section>
  );
}
