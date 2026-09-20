"use client";

import { useEffect, useRef, useState } from "react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { initialsFor } from "@/lib/initials";
import { useMessages } from "@/i18n/client";
import { LOCALE_NAMES, LOCALES, type Locale } from "@/i18n/locales";
import { setLocaleAction } from "@/app/locale-actions";
import { setThemeAction } from "@/app/theme-actions";
import { THEMES, type Theme } from "@/lib/theme";

/**
 * The only thing in the top bar besides the wordmark: one button carrying the
 * signed-in person's initials, which opens their settings and sign out.
 */
export function UserMenu({
  user,
  locale,
  theme,
  signOut,
}: {
  user: { name: string; email: string; role: string };
  locale: Locale;
  theme: Theme;
  signOut: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const localeFormRef = useRef<HTMLFormElement>(null);
  const themeFormRef = useRef<HTMLFormElement>(null);
  const t = useMessages();

  const initials = initialsFor(user.name, user.email);

  useEffect(() => {
    if (!open) return;

    // Focus lands inside, so the keyboard follows the pointer.
    panelRef.current?.querySelector("select")?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    }

    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  // Both settings apply on change: a menu this small has nothing to submit.
  const select =
    "h-9 w-full rounded-md border bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t.app.accountMenuFor(user.name || user.email)}
        onClick={() => setOpen((current) => !current)}
        className="flex size-9 items-center justify-center rounded-full border bg-[var(--muted)] text-xs font-semibold tracking-wide text-[var(--foreground)] transition-colors hover:bg-[var(--border)]"
      >
        {initials}
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label={t.app.account}
          className="absolute right-0 z-40 mt-2 w-72 rounded-lg border bg-[var(--card)] p-4 shadow-lg motion-safe:animate-[fade-in_120ms_ease-out]"
        >
          <div className="flex flex-col gap-1 border-b pb-3">
            <span className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
              {t.app.signedInAs}
            </span>
            {user.name && <span className="text-sm font-medium">{user.name}</span>}
            <span className="truncate text-sm text-[var(--muted-foreground)]">{user.email}</span>
            <span className="mt-1 w-fit rounded-full border px-2 py-0.5 text-xs text-[var(--muted-foreground)]">
              {user.role}
            </span>
          </div>

          <form ref={localeFormRef} action={setLocaleAction} className="flex flex-col gap-1 pt-3">
            <label htmlFor="locale" className="text-sm font-medium">
              {t.app.language}
            </label>
            <select
              id="locale"
              name="locale"
              defaultValue={locale}
              onChange={() => localeFormRef.current?.requestSubmit()}
              className={select}
            >
              {LOCALES.map((option) => (
                <option key={option} value={option}>
                  {LOCALE_NAMES[option]}
                </option>
              ))}
            </select>
          </form>

          <form ref={themeFormRef} action={setThemeAction} className="flex flex-col gap-1 py-3">
            <label htmlFor="theme" className="text-sm font-medium">
              {t.app.theme}
            </label>
            <select
              id="theme"
              name="theme"
              defaultValue={theme}
              onChange={() => themeFormRef.current?.requestSubmit()}
              className={select}
            >
              {THEMES.map((option) => (
                <option key={option} value={option}>
                  {t.app.themes[option]}
                </option>
              ))}
            </select>
          </form>

          <form action={signOut} className="border-t pt-3">
            <Button type="submit" variant="outline" size="sm" className="w-full">
              <LogOut className="size-4" aria-hidden />
              {t.app.signOut}
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
