"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/alert";
import { useMessages } from "@/i18n/client";
import type { FormState } from "@/lib/form";
import type { RackView, RackWarning } from "@/server/services/racks";
import {
  addMountAction,
  removeMountAction,
  saveRackAction,
  setTypeColorAction,
} from "./rack-actions";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  const t = useMessages();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? t.common.saving : label}
    </Button>
  );
}

const selectClass = "h-10 w-full rounded-md border bg-transparent px-3 text-sm outline-none";

function warningText(warning: RackWarning, t: ReturnType<typeof useMessages>): string {
  switch (warning.kind) {
    case "too_close":
      return t.documents.rack.tooClose(warning.types[0], warning.types[1]);
    case "override_shadows_global":
      return t.documents.rack.overrideShadows(warning.type, warning.collidesWith);
    case "overlap":
      return t.documents.rack.overlap(warning.names[0], warning.names[1], warning.units);
    case "out_of_range":
      return t.documents.rack.outOfRange(warning.name);
  }
}

/** The colour of one kind of equipment, set for everyone or for this client. */
function ColorRow({
  documentId,
  companyId,
  entry,
}: {
  documentId: string;
  companyId: string;
  entry: RackView["legend"][number];
}) {
  const [state, formAction] = useActionState<FormState, FormData>(setTypeColorAction, {});
  const t = useMessages();

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2">
      <span
        aria-hidden
        className="size-4 shrink-0 rounded border"
        style={{ backgroundColor: entry.color }}
      />
      <span className="min-w-0 flex-1 text-sm">
        {entry.docTypeName}
        {entry.source === "company" && (
          <span className="ml-2 rounded-full border px-2 py-0.5 text-xs text-[var(--muted-foreground)]">
            {t.documents.rack.overridden}
            {entry.globalColor ? ` · ${t.documents.rack.defaultIs(entry.globalColor)}` : ""}
          </span>
        )}
      </span>

      <form action={formAction} className="flex items-center gap-2">
        <input type="hidden" name="documentId" value={documentId} />
        <input type="hidden" name="docTypeId" value={entry.docTypeId} />
        <label className="sr-only" htmlFor={`color-${entry.docTypeId}`}>
          {entry.docTypeName}
        </label>
        <input
          id={`color-${entry.docTypeId}`}
          type="color"
          name="color"
          defaultValue={entry.color}
          className="size-8 cursor-pointer rounded border bg-transparent"
        />
        <Button type="submit" variant="outline" size="sm">
          {t.documents.rack.setGlobal}
        </Button>
        <Button type="submit" variant="ghost" size="sm" name="companyId" value={companyId}>
          {t.documents.rack.setCompany}
        </Button>
        {state.error && <span className="text-xs text-[var(--destructive)]">{state.error}</span>}
      </form>
    </li>
  );
}

export function RackPanel({
  view,
  editor,
  mountable,
  docTypes,
}: {
  view: RackView;
  editor: boolean;
  /** Documents in this company that could be mounted. */
  mountable: { id: string; title: string }[];
  docTypes: { id: string; name: string }[];
}) {
  const t = useMessages();
  const [settings, settingsAction] = useActionState<FormState, FormData>(saveRackAction, {});
  const [mountState, mountAction] = useActionState<FormState, FormData>(addMountAction, {});

  const faces = view.hasRear ? (["front", "rear"] as const) : (["front"] as const);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold tracking-tight">{t.documents.rack.heading}</h3>
          <p className="text-sm text-[var(--muted-foreground)]">{t.documents.rack.subtitle}</p>
        </div>
        <div className="flex gap-2 print:hidden">
          {faces.map((face) => (
            <a
              key={face}
              href={`/documents/${view.documentId}/rack.svg?face=${face}`}
              download={`rack-${face}.svg`}
              className="text-sm underline"
            >
              {t.documents.rack.download(
                face === "front" ? t.documents.rack.front : t.documents.rack.rear,
              )}
            </a>
          ))}
        </div>
      </div>

      {view.warnings.length > 0 && (
        <div className="rounded-md border border-[oklch(0.76_0.15_75)] px-3 py-2">
          <p className="text-sm font-medium">{t.documents.rack.warnings}</p>
          <ul className="mt-1 flex flex-col gap-1">
            {view.warnings.map((warning, index) => (
              <li key={index} className="text-sm text-[var(--muted-foreground)]">
                {warningText(warning, t)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-6">
        {faces.map((face) => (
          <figure key={face} className="flex flex-col gap-2">
            <figcaption className="text-sm font-medium">
              {face === "front" ? t.documents.rack.front : t.documents.rack.rear}
            </figcaption>
            {/* The drawing is served as a file so print and download agree. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/documents/${view.documentId}/rack.svg?face=${face}&v=${view.version}`}
              alt={`${view.name} ${face} elevation`}
              className="max-w-full rounded-md border bg-white"
            />
          </figure>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-medium">{t.documents.rack.contents}</h4>
        {view.mounts.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">{t.documents.rack.empty}</p>
        ) : (
          <ul aria-label={t.documents.rack.contents} className="flex flex-col gap-1">
            {[...view.mounts]
              .sort((a, b) => b.positionU - a.positionU)
              .map((mount) => (
                <li
                  key={mount.id}
                  className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 text-sm"
                >
                  <span className="w-20 shrink-0 font-mono text-xs text-[var(--muted-foreground)]">
                    U{mount.positionU}
                    {mount.heightU > 1 ? `–${mount.positionU + mount.heightU - 1}` : ""}
                  </span>
                  <span
                    aria-hidden
                    className="size-3 shrink-0 rounded"
                    style={{ backgroundColor: mount.color }}
                  />
                  <span className="min-w-0 flex-1">
                    {mount.documentId ? (
                      <Link href={`/documents/${mount.documentId}`} className="hover:underline">
                        {mount.name}
                      </Link>
                    ) : (
                      mount.name
                    )}
                    {mount.typeName && (
                      <span className="ml-2 text-xs text-[var(--muted-foreground)]">
                        {mount.typeName}
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-[var(--muted-foreground)]">{mount.face}</span>

                  {editor && (
                    <form action={removeMountAction} className="print:hidden">
                      <input type="hidden" name="mountId" value={mount.id} />
                      <input type="hidden" name="documentId" value={view.documentId} />
                      <Button type="submit" variant="ghost" size="sm">
                        {t.documents.rack.remove}
                      </Button>
                    </form>
                  )}
                </li>
              ))}
          </ul>
        )}
      </div>

      {view.legend.length > 0 && (
        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-medium">{t.documents.rack.key}</h4>
          <ul aria-label={t.documents.rack.key} className="flex flex-col gap-1">
            {view.legend.map((entry) => (
              <ColorRow
                key={entry.docTypeId}
                documentId={view.documentId}
                companyId={view.companyId}
                entry={entry}
              />
            ))}
          </ul>
        </div>
      )}

      {editor && (
        <div className="flex flex-col gap-4 print:hidden">
          <form action={mountAction} className="flex flex-col gap-3 rounded-md border p-4">
            <FormError>{mountState.error}</FormError>
            <input type="hidden" name="documentId" value={view.documentId} />
            <h4 className="text-sm font-medium">{t.documents.rack.mount}</h4>

            <div className="grid gap-3 sm:grid-cols-3">
              <Field id="positionU" label={t.documents.rack.position}>
                <Input id="positionU" name="positionU" type="number" min={1} max={60} defaultValue={1} />
              </Field>
              <Field id="heightU" label={t.documents.rack.height}>
                <Input id="heightU" name="heightU" type="number" min={1} max={20} defaultValue={1} />
              </Field>
              <Field id="face" label={t.documents.rack.face}>
                <select id="face" name="face" className={selectClass}>
                  <option value="front">{t.documents.rack.front}</option>
                  <option value="rear">{t.documents.rack.rear}</option>
                  <option value="both">{t.documents.rack.faceBoth}</option>
                </select>
              </Field>
            </div>

            <Field id="mountedId" label={t.documents.rack.document} hint={t.documents.rack.documentHint}>
              <select id="mountedId" name="mountedId" className={selectClass} defaultValue="">
                <option value="">—</option>
                {mountable.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.title}
                  </option>
                ))}
              </select>
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                id="label"
                label={t.documents.rack.label}
                hint={t.documents.rack.labelHint}
                error={mountState.fieldErrors?.label}
              >
                <Input id="label" name="label" maxLength={200} placeholder="Patch panel A" />
              </Field>
              <Field id="docTypeId" label={t.documents.rack.type} hint={t.documents.rack.typeHint}>
                <select id="docTypeId" name="docTypeId" className={selectClass} defaultValue="">
                  <option value="">—</option>
                  {docTypes.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div>
              <Submit label={t.documents.rack.add} />
            </div>
          </form>

          <form action={settingsAction} className="flex flex-col gap-3 rounded-md border p-4">
            <FormError>{settings.error}</FormError>
            <input type="hidden" name="documentId" value={view.documentId} />

            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="totalU" label={t.documents.rack.size} hint={t.documents.rack.sizeHint}>
                <Input
                  id="totalU"
                  name="totalU"
                  type="number"
                  min={1}
                  max={60}
                  defaultValue={view.totalU}
                />
              </Field>
              <Field
                id="numbering"
                label={t.documents.rack.numbering}
                hint={t.documents.rack.numberingHint}
              >
                <select
                  id="numbering"
                  name="numbering"
                  defaultValue={view.numbering}
                  className={selectClass}
                >
                  <option value="bottom_up">{t.documents.rack.bottomUp}</option>
                  <option value="top_down">{t.documents.rack.topDown}</option>
                </select>
              </Field>
            </div>

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                name="hasRear"
                defaultChecked={view.hasRear}
                className="mt-0.5 size-4 rounded border"
              />
              <span>
                <span className="font-medium">{t.documents.rack.hasRear}</span>
                <span className="block text-xs text-[var(--muted-foreground)]">
                  {t.documents.rack.hasRearHint}
                </span>
              </span>
            </label>

            <div>
              <Submit label={t.documents.rack.save} />
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
