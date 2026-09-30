"use client";

import { useEffect, useId, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useMessages } from "@/i18n/client";

/**
 * A section of the front page that folds. Open unless this browser folded
 * it, and open again by itself when what it holds has changed since: the
 * fold is remembered together with a fingerprint of the content, and a
 * different fingerprint means there is something new to see.
 */
export function KbSection({
  id,
  heading,
  hint,
  fingerprint,
  controls,
  children,
}: {
  id: string;
  heading: string;
  hint?: string;
  /** Changes when the section's content does. */
  fingerprint: string;
  /** Sort and view controls, shown beside the heading while open. */
  controls?: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useMessages();
  const key = `bothy.kb.section.${id}`;
  const bodyId = useId();
  const [open, setOpen] = useState(true);

  useEffect(() => {
    try {
      const kept = localStorage.getItem(key);
      if (!kept) return;
      const parsed = JSON.parse(kept) as { fingerprint?: string };
      // Folded on the same content: stay folded. Anything new: open up.
      // The fold lives in this browser alone, so it is read after the
      // server's copy, which is always open, has been drawn.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (parsed.fingerprint === fingerprint) setOpen(false);
      else localStorage.removeItem(key);
    } catch {
      // Nothing kept, or nothing readable: open it is.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerprint]);

  function toggle() {
    const next = !open;
    setOpen(next);
    try {
      if (next) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify({ fingerprint }));
    } catch {
      // Storage may be off; the fold still works for this page.
    }
  }

  return (
    <section aria-label={heading} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={bodyId}
          className="flex min-w-0 items-center gap-2 text-left"
        >
          {open ? (
            <ChevronDown className="size-4 shrink-0 text-[var(--muted-foreground)]" aria-hidden />
          ) : (
            <ChevronRight className="size-4 shrink-0 text-[var(--muted-foreground)]" aria-hidden />
          )}
          <span className="min-w-0">
            <span className="block text-lg font-semibold tracking-tight">{heading}</span>
            {hint && open && (
              <span className="block text-sm text-[var(--muted-foreground)]">{hint}</span>
            )}
          </span>
          <span className="sr-only">{open ? t.kb.collapse : t.kb.expand}</span>
        </button>
        {open && controls}
      </div>
      {open && <div id={bodyId}>{children}</div>}
    </section>
  );
}
