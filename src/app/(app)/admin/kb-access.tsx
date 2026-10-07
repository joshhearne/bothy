"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { FormError } from "@/components/ui/alert";
import { Select } from "@/components/ui/select";
import { useMessages } from "@/i18n/client";
import type { GrantLevel, GrantMatrixRow } from "@/server/services/kb-grants";
import { setGrantMatrixAction, type MatrixState } from "./kb-actions";

const LEVELS: GrantLevel[] = ["none", "read", "write"];

type Row = GrantMatrixRow & { public: boolean };

/**
 * One key against every collection: what it may do on each, set in one
 * pass. A master row sets every row at once, and any row can then be
 * changed on its own, which is how a key gets read everywhere and write
 * on the one collection it keeps.
 */
export function KbAccessMatrix({
  keys,
  selectedKeyId,
  rows,
}: {
  keys: { id: string; name: string; prefix: string }[];
  selectedKeyId: string | null;
  rows: Row[];
}) {
  const t = useMessages().admin.kb;
  const router = useRouter();
  const [levels, setLevels] = useState<Record<string, GrantLevel>>(() =>
    Object.fromEntries(rows.map((row) => [row.collectionId, row.level])),
  );
  const [reactions, setReactions] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(rows.map((row) => [row.collectionId, row.reactions])),
  );
  const [state, formAction, pending] = useActionState<MatrixState, FormData>(setGrantMatrixAction, {});

  const levelLabel: Record<GrantLevel, string> = { none: t.accessDefault, read: t.accessRead, write: t.accessWrite };
  const allLevel = LEVELS.find((level) => rows.every((row) => levels[row.collectionId] === level)) ?? null;
  const allReactions = rows.every((row) => reactions[row.collectionId]);

  const setAll = (level: GrantLevel) =>
    setLevels(Object.fromEntries(rows.map((row) => [row.collectionId, level])));
  const setAllReactions = (on: boolean) =>
    setReactions(Object.fromEntries(rows.map((row) => [row.collectionId, on])));

  const radios = (name: string, value: GrantLevel | null, onPick: (level: GrantLevel) => void, label: string) =>
    LEVELS.map((level) => (
      <label key={level} className="flex items-center justify-center gap-1 text-sm" title={label}>
        <input
          type="radio"
          name={name}
          value={level}
          checked={value === level}
          onChange={() => onPick(level)}
          aria-label={`${label}: ${levelLabel[level]}`}
          className="size-4 accent-[var(--primary)]"
        />
        <span className="sm:hidden">{levelLabel[level]}</span>
      </label>
    ));

  return (
    <div className="flex flex-col gap-5">
      <label className="flex max-w-md flex-col gap-2 text-sm">
        <span className="font-medium">{t.accessKey}</span>
        <Select
          value={selectedKeyId ?? ""}
          onChange={(event) => router.push(`/admin/kb/access?key=${event.target.value}`)}
          className="h-10 rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          {keys.map((key) => (
            <option key={key.id} value={key.id}>
              {key.name} ({key.prefix}…)
            </option>
          ))}
        </Select>
      </label>

      <p className="text-xs text-[var(--muted-foreground)]">{t.accessLegend}</p>

      {selectedKeyId && (
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="apiKeyId" value={selectedKeyId} />
          <FormError>{state.error}</FormError>

          <div className="overflow-x-auto rounded-md border">
            <div className="hidden grid-cols-[1fr_3rem_3rem_3rem_6rem] items-center gap-2 border-b px-4 py-2 text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)] sm:grid">
              <span>{t.accessCollection}</span>
              <span className="text-center">{t.accessDefault}</span>
              <span className="text-center">{t.accessRead}</span>
              <span className="text-center">{t.accessWrite}</span>
              <span className="text-center">{t.accessReactions}</span>
            </div>

            {/* The master row: one lever for every collection, then each row on its own. */}
            <div className="grid grid-cols-1 items-center gap-2 border-b bg-[var(--muted)] px-4 py-2 sm:grid-cols-[1fr_3rem_3rem_3rem_6rem]">
              <div>
                <p className="text-sm font-medium">{t.accessMaster}</p>
                <p className="text-xs text-[var(--muted-foreground)]">{t.accessMasterHint}</p>
              </div>
              <div className="flex gap-4 sm:contents">{radios("master", allLevel, setAll, t.accessMaster)}</div>
              <label className="flex items-center justify-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={allReactions}
                  onChange={(event) => setAllReactions(event.target.checked)}
                  aria-label={`${t.accessReactions}: ${t.accessMaster}`}
                  className="size-4 accent-[var(--primary)]"
                />
                <span className="sm:hidden">{t.accessReactions}</span>
              </label>
            </div>

            <ul className="divide-y">
              {rows.map((row) => (
                <li
                  key={row.collectionId}
                  className="grid grid-cols-1 items-center gap-2 px-4 py-2 sm:grid-cols-[1fr_3rem_3rem_3rem_6rem]"
                >
                  <input type="hidden" name="collectionId" value={row.collectionId} />
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">{row.name}</span>
                    {row.public && (
                      <Chip tone="green" className="shrink-0">
                        <span title={t.accessPublicNote}>{t.accessPublicBadge}</span>
                      </Chip>
                    )}
                  </div>
                  <div className="flex gap-4 sm:contents">
                    {radios(
                      `level-${row.collectionId}`,
                      levels[row.collectionId] ?? "none",
                      (level) => setLevels((current) => ({ ...current, [row.collectionId]: level })),
                      t.accessLevelFor(row.name),
                    )}
                  </div>
                  <label className="flex items-center justify-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name={`reactions-${row.collectionId}`}
                      checked={reactions[row.collectionId] ?? true}
                      onChange={(event) =>
                        setReactions((current) => ({ ...current, [row.collectionId]: event.target.checked }))
                      }
                      aria-label={t.accessReactionsFor(row.name)}
                      className="size-4 accent-[var(--primary)]"
                    />
                    <span className="sm:hidden">{t.accessReactions}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={pending}>
              {t.accessSave}
            </Button>
            {state.ok && (
              <span className="text-sm text-[var(--muted-foreground)]">
                {t.accessSaved(state.changed ?? 0)}
              </span>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
