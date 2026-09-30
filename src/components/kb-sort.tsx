"use client";

import { useEffect } from "react";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMessages } from "@/i18n/client";

/**
 * How a list is ordered. The choice goes in the address, so the page can be
 * shared as it is seen, and is remembered in this browser under `scope`, so
 * the next visit opens the same way without anyone having to be signed in.
 */
export function KbSort({
  scope,
  sorts,
  sort,
  dir,
}: {
  scope: string;
  sorts: readonly string[];
  sort: string;
  dir: "asc" | "desc";
}) {
  const t = useMessages();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const key = `bothy.kb.sort.${scope}`;

  const labels = t.kb.sorts as Record<string, string>;

  function go(next: { sort: string; dir: string }) {
    const query = new URLSearchParams(params.toString());
    query.set("sort", next.sort);
    query.set("dir", next.dir);
    query.delete("cursor");
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // Storage may be off; the address still carries the choice.
    }
    router.replace(`${pathname}?${query.toString()}` as Route);
  }

  // A visit that names no order opens the way this browser last chose.
  useEffect(() => {
    if (params.has("sort")) return;
    try {
      const kept = localStorage.getItem(key);
      if (!kept) return;
      const parsed = JSON.parse(kept) as { sort?: string; dir?: string };
      if (
        parsed.sort &&
        sorts.includes(parsed.sort) &&
        (parsed.dir === "asc" || parsed.dir === "desc") &&
        (parsed.sort !== sort || parsed.dir !== dir)
      ) {
        go({ sort: parsed.sort, dir: parsed.dir });
      }
    } catch {
      // Nothing kept, or nothing readable: the default order stands.
    }
    // Only on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const control =
    "h-9 rounded-md border bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
        {t.kb.sortBy}
        <select
          value={sort}
          // A new sort runs its natural way: names A to Z, everything else
          // most first. The other control still turns it around.
          onChange={(event) =>
            go({ sort: event.target.value, dir: event.target.value === "name" ? "asc" : "desc" })
          }
          className={control}
        >
          {sorts.map((option) => (
            <option key={option} value={option}>
              {labels[option] ?? option}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
        {t.kb.direction}
        <select
          value={dir}
          onChange={(event) => go({ sort, dir: event.target.value })}
          className={control}
        >
          <option value="asc">{t.kb.ascending}</option>
          <option value="desc">{t.kb.descending}</option>
        </select>
      </label>
    </div>
  );
}
