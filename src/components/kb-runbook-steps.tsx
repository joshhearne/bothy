"use client";

import { createContext, useContext, useState } from "react";
import { useMessages } from "@/i18n/client";

export type RenderedStep = {
  id: string;
  /** The step's text, rendered. */
  html: string;
  /** What sits under the step, rendered, when there is any. */
  noteHtml: string | null;
  canned: string | null;
};

type Run = { done: Set<string>; toggle: (id: string) => void; total: number };
const RunContext = createContext<Run>({ done: new Set(), toggle: () => {}, total: 0 });

/**
 * One reading of a runbook. The ticks live in this page alone: Trove KB keeps
 * no record of a run, so nothing here is sent anywhere, and a reload starts
 * over. Wraps every checklist the runbook has, so the count is one count.
 */
export function RunbookRun({ total, children }: { total: number; children: React.ReactNode }) {
  const [done, setDone] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) => {
    setDone((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  return <RunContext.Provider value={{ done, toggle, total }}>{children}</RunContext.Provider>;
}

/** A run of a runbook's steps as a checklist, numbered on from the steps before it. */
export function RunbookSteps({ steps, first = 0 }: { steps: RenderedStep[]; first?: number }) {
  const t = useMessages();
  const { done, toggle, total } = useContext(RunContext);

  return (
    <section aria-label={t.kb.runbookSteps} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">{t.kb.runbookSteps}</h2>
        <span className="text-xs text-[var(--muted-foreground)] tabular-nums">
          {t.kb.runbookDone(done.size, total || steps.length)}
        </span>
      </div>
      <ol className="flex flex-col gap-2" start={first + 1}>
        {steps.map((step, index) => {
          const ticked = done.has(step.id);
          return (
            <li
              key={step.id}
              id={`step-${step.id}`}
              className={"flex gap-3 rounded-md border px-3 py-2 " + (ticked ? "opacity-60" : "")}
            >
              <input
                type="checkbox"
                checked={ticked}
                onChange={() => toggle(step.id)}
                aria-label={`${first + index + 1}`}
                className="mt-1 size-4 shrink-0 accent-[var(--primary)]"
              />
              <div className="min-w-0 flex-1">
                <div className="flex gap-2">
                  <span className="shrink-0 text-sm font-medium tabular-nums text-[var(--muted-foreground)]">
                    {first + index + 1}.
                  </span>
                  <div
                    className={"prose-editor kb-article min-w-0 text-sm break-words " + (ticked ? "line-through" : "")}
                    dangerouslySetInnerHTML={{ __html: step.html }}
                  />
                </div>
                {step.noteHtml && (
                  <div
                    className="prose-editor kb-article mt-1 min-w-0 pl-6 text-sm break-words text-[var(--muted-foreground)]"
                    dangerouslySetInnerHTML={{ __html: step.noteHtml }}
                  />
                )}
                {step.canned && (
                  <p className="mt-1 pl-6 text-xs text-[var(--muted-foreground)]">{t.kb.runbookCanned(step.canned)}</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {first + steps.length >= total && (
        <p className="text-xs text-[var(--muted-foreground)]">{t.kb.runbookHint}</p>
      )}
    </section>
  );
}
