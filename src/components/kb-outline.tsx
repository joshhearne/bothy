"use client";

import { useEffect, useId, useState } from "react";
import { List, X } from "lucide-react";
import { useMessages } from "@/i18n/client";
import type { OutlineItem } from "@/server/kb/outline";

/**
 * Where an article's headings are, as a way to get to them. On a wide screen
 * it floats to the right of the text, outside its margins, and follows the
 * reader down. On a narrow one it is a button at the foot of the screen that
 * opens into a card. Drawn only when there are headings to go to.
 */
export function KbOutline({ items }: { items: OutlineItem[] }) {
  const t = useMessages();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const cardId = useId();

  // The heading nearest the top of the viewport is the current one.
  useEffect(() => {
    const headings = items
      .map((item) => document.getElementById(item.id))
      .filter((element): element is HTMLElement => element !== null);
    if (headings.length === 0) return;

    const update = () => {
      const line = 96;
      let nearest: HTMLElement | null = null;
      for (const heading of headings) {
        if (heading.getBoundingClientRect().top <= line) nearest = heading;
        else break;
      }
      setCurrent((nearest ?? headings[0] ?? null)?.id ?? null);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [items]);

  if (items.length === 0) return null;

  const links = (onPick?: () => void) => (
    <ol className="flex flex-col gap-0.5 text-sm">
      {items.map((item) => (
        <li key={item.id} style={{ paddingLeft: `${(item.level - 1) * 0.75}rem` }}>
          <a
            href={`#${item.id}`}
            onClick={onPick}
            aria-current={current === item.id ? "location" : undefined}
            className={
              "block rounded px-2 py-1 leading-snug break-words hover:bg-[var(--muted)] " +
              (current === item.id
                ? "font-medium text-[var(--primary)]"
                : "text-[var(--muted-foreground)]")
            }
          >
            {item.text}
          </a>
        </li>
      ))}
    </ol>
  );

  return (
    <>
      <nav
        aria-label={t.kb.outline}
        className="sticky top-20 hidden max-h-[calc(100vh-6rem)] w-56 shrink-0 self-start overflow-y-auto xl:block"
      >
        <p className="mb-2 px-2 text-xs font-semibold tracking-wide text-[var(--muted-foreground)] uppercase">
          {t.kb.outline}
        </p>
        {links()}
      </nav>

      <div className="fixed right-4 bottom-4 z-30 flex flex-col items-end gap-2 xl:hidden">
        {open && (
          <nav
            id={cardId}
            aria-label={t.kb.outline}
            className="max-h-[60vh] w-72 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border bg-[var(--card)] p-3 shadow-lg"
          >
            <p className="mb-2 px-2 text-xs font-semibold tracking-wide text-[var(--muted-foreground)] uppercase">
              {t.kb.outline}
            </p>
            {links(() => setOpen(false))}
          </nav>
        )}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={cardId}
          onClick={() => setOpen((value) => !value)}
          className="inline-flex items-center gap-2 rounded-full border bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] shadow-lg"
        >
          {open ? <X className="size-4" aria-hidden /> : <List className="size-4" aria-hidden />}
          {open ? t.common.close : t.kb.outline}
        </button>
      </div>
    </>
  );
}
