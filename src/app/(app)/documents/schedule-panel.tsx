"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/alert";
import { useMessages } from "@/i18n/client";
import type { FormState } from "@/lib/form";
import type { DocumentSchedule } from "@/server/services/schedules";
import { clearScheduleAction, markDoneAction, saveScheduleAction } from "./schedule-actions";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  const t = useMessages();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? t.common.saving : label}
    </Button>
  );
}

const DOT: Record<string, string> = {
  ok: "bg-[color-mix(in_oklab,var(--primary)_70%,transparent)]",
  due_soon: "bg-[oklch(0.76_0.15_75)]",
  overdue: "bg-[var(--destructive)]",
};

/** When this document needs looking at again, and how loudly to say so. */
export function SchedulePanel({
  documentId,
  schedule,
  editor,
}: {
  documentId: string;
  schedule: DocumentSchedule | null;
  editor: boolean;
}) {
  const t = useMessages();
  const [state, formAction] = useActionState<FormState, FormData>(saveScheduleAction, {});
  const [kind, setKind] = useState(schedule?.kind ?? "expiry");

  const summary = schedule
    ? schedule.status === "overdue"
      ? t.documents.schedule.overdue(Math.abs(schedule.daysRemaining))
      : schedule.status === "due_soon"
        ? t.documents.schedule.dueSoon(schedule.daysRemaining)
        : t.documents.schedule.ok(schedule.dueOn)
    : t.documents.schedule.none;

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h3 className="text-lg font-semibold tracking-tight">{t.documents.schedule.heading}</h3>
        <p className="text-sm text-[var(--muted-foreground)]">{t.documents.schedule.subtitle}</p>
      </div>

      <p className="flex items-center gap-2 text-sm">
        {schedule && (
          <span aria-hidden className={`size-2 shrink-0 rounded-full ${DOT[schedule.status]}`} />
        )}
        {summary}
        {schedule?.lastDoneOn && (
          <span className="text-[var(--muted-foreground)]">
            {t.documents.schedule.lastDone(schedule.lastDoneOn)}
          </span>
        )}
      </p>

      {editor && (
        <div className="flex flex-col gap-3">
          {schedule && (
            <div className="flex flex-wrap gap-2">
              <form action={markDoneAction}>
                <input type="hidden" name="documentId" value={documentId} />
                <Button type="submit" variant="outline" size="sm">
                  {t.documents.schedule.done}
                </Button>
              </form>
              <form action={clearScheduleAction}>
                <input type="hidden" name="documentId" value={documentId} />
                <Button type="submit" variant="ghost" size="sm">
                  {t.documents.schedule.clear}
                </Button>
              </form>
            </div>
          )}

          <form action={formAction} className="flex flex-col gap-3 rounded-md border p-4">
            <FormError>{state.error}</FormError>
            <input type="hidden" name="documentId" value={documentId} />

            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="kind" label={t.documents.schedule.kind}>
                <select
                  id="kind"
                  name="kind"
                  defaultValue={kind}
                  onChange={(event) => setKind(event.target.value as typeof kind)}
                  className="h-10 w-full rounded-md border bg-transparent px-3 text-sm"
                >
                  <option value="expiry">{t.documents.schedule.expiry}</option>
                  <option value="maintenance">{t.documents.schedule.maintenance}</option>
                </select>
              </Field>

              <Field id="dueOn" label={t.documents.schedule.dueOn} error={state.fieldErrors?.dueOn}>
                <Input
                  id="dueOn"
                  name="dueOn"
                  type="date"
                  defaultValue={schedule?.dueOn ?? ""}
                  required
                />
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {kind === "maintenance" && (
                <Field
                  id="intervalDays"
                  label={t.documents.schedule.interval}
                  hint={t.documents.schedule.intervalHint}
                  error={state.fieldErrors?.intervalDays}
                >
                  <Input
                    id="intervalDays"
                    name="intervalDays"
                    type="number"
                    min={1}
                    max={3650}
                    defaultValue={schedule?.intervalDays ?? 90}
                  />
                </Field>
              )}

              <Field id="leadDays" label={t.documents.schedule.lead}>
                <Input
                  id="leadDays"
                  name="leadDays"
                  type="number"
                  min={0}
                  max={365}
                  defaultValue={schedule?.leadDays ?? 30}
                />
              </Field>
            </div>

            <Field id="note" label={t.documents.schedule.note}>
              <Input id="note" name="note" maxLength={500} defaultValue={schedule?.note ?? ""} />
            </Field>

            <div>
              <Submit label={t.documents.schedule.save} />
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
