"use client";

import { useEffect } from "react";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LayoutGrid, List } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMessages } from "@/i18n/client";

export type KbViewKind = "cards" | "list";

/**
 * Cards or a list. Like the sort, the choice rides in the address and is
 * remembered in this browser, so each person gets the shape they prefer
 * without anyone having to be signed in.
 */
export function KbView({ view }: { view: KbViewKind }) {
  const t = useMessages();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const key = "bothy.kb.view";

  function go(next: KbViewKind) {
    const query = new URLSearchParams(params.toString());
    query.set("view", next);
    try {
      localStorage.setItem(key, next);
    } catch {
      // Storage may be off; the address still carries the choice.
    }
    router.replace(`${pathname}?${query.toString()}` as Route);
  }

  useEffect(() => {
    if (params.has("view")) return;
    try {
      const kept = localStorage.getItem(key);
      if ((kept === "cards" || kept === "list") && kept !== view) go(kept);
    } catch {
      // Nothing kept: cards it is.
    }
    // Only on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const button = (kind: KbViewKind, label: string, Icon: typeof List) => (
    <button
      type="button"
      onClick={() => go(kind)}
      aria-pressed={view === kind}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-md border outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
        view === kind
          ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
          : "text-[var(--muted-foreground)] hover:bg-[var(--muted)]",
      )}
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );

  return (
    <div role="group" aria-label={t.kb.view} className="flex items-center gap-1">
      {button("cards", t.kb.viewCards, LayoutGrid)}
      {button("list", t.kb.viewList, List)}
    </div>
  );
}
