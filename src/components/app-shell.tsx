"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { Building2, Layers, ListTree, Menu, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type SidebarCompany = { id: string; name: string; isInternal: boolean };

export type AppShellProps = {
  user: { email: string; role: string };
  companies: SidebarCompany[];
  canCreateCompanies: boolean;
  canManageDocTypes: boolean;
  signOut: () => Promise<void>;
  children: React.ReactNode;
};

/**
 * The application shell: navigation lives in the left sidebar at every size —
 * a persistent column from `md` up, a drawer below it. The top bar carries only
 * the wordmark, the drawer control, and who is signed in.
 */
export function AppShell({
  user,
  companies,
  canCreateCompanies,
  canManageDocTypes,
  signOut,
  children,
}: AppShellProps) {
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    closeRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Opaque on purpose: a backdrop-filter here forms a backdrop root and
          paints through the mobile drawer's overlay. */}
      <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b bg-[var(--background)] px-4">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="-ml-2 md:hidden"
          aria-label="Open navigation"
          aria-expanded={open}
          aria-controls="app-navigation"
          onClick={() => setOpen(true)}
        >
          <Menu className="size-5" aria-hidden />
        </Button>

        <Link href="/companies" className="font-semibold tracking-tight">
          Strata
        </Link>

        <div className="ml-auto flex items-center gap-3">
          <span className="hidden text-sm text-[var(--muted-foreground)] sm:inline">
            {user.email}
          </span>
          <span className="rounded-full border px-2 py-0.5 text-xs text-[var(--muted-foreground)]">
            {user.role}
          </span>
          <form action={signOut}>
            <Button type="submit" variant="outline" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </header>

      <div className="flex flex-1">
        {/* Desktop: a column that scrolls on its own beneath the sticky bar. */}
        <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-64 shrink-0 overflow-y-auto border-r bg-[var(--sidebar)] md:block">
          <SidebarNav
            companies={companies}
            canCreateCompanies={canCreateCompanies}
            canManageDocTypes={canManageDocTypes}
          />
        </aside>

        <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
      </div>

      {/* Mobile: the same navigation as a drawer, above the sticky bar. */}
      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/50 motion-safe:animate-[fade-in_150ms_ease-out]"
          />
          <div
            id="app-navigation"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto border-r bg-[var(--sidebar)] shadow-xl motion-safe:animate-[slide-in-left_200ms_cubic-bezier(0.16,1,0.3,1)]"
          >
            <div className="flex h-14 shrink-0 items-center justify-between border-b px-4">
              <span className="font-semibold tracking-tight">Strata</span>
              <Button
                ref={closeRef}
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Close navigation"
                onClick={() => setOpen(false)}
              >
                <X className="size-5" aria-hidden />
              </Button>
            </div>
            <SidebarNav
              companies={companies}
              canCreateCompanies={canCreateCompanies}
              canManageDocTypes={canManageDocTypes}
              onNavigate={() => setOpen(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function SidebarNav({
  companies,
  canCreateCompanies,
  canManageDocTypes,
  onNavigate,
}: {
  companies: SidebarCompany[];
  canCreateCompanies: boolean;
  canManageDocTypes: boolean;
  onNavigate?: (() => void) | undefined;
}) {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="flex flex-col gap-6 px-3 py-4">
      <Section
        title="Companies"
        action={
          canCreateCompanies ? (
            <Link
              href="/companies/new"
              aria-label="New company"
              onClick={onNavigate}
              className="rounded-md p-1 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
            >
              <Plus className="size-4" aria-hidden />
            </Link>
          ) : undefined
        }
      >
        <NavLink
          href="/companies"
          icon={Building2}
          active={pathname === "/companies"}
          onNavigate={onNavigate}
        >
          All companies
        </NavLink>

        {companies.length === 0 ? (
          <p className="px-2 py-1.5 text-sm text-[var(--muted-foreground)]">No companies yet.</p>
        ) : (
          companies.map((company) => {
            const href = `/companies/${company.id}` as const;
            return (
              <NavLink
                key={company.id}
                href={href}
                active={pathname === href || pathname.startsWith(`${href}/`)}
                onNavigate={onNavigate}
                indent
                trailing={
                  company.isInternal ? (
                    <span className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
                      internal
                    </span>
                  ) : undefined
                }
              >
                {company.name}
              </NavLink>
            );
          })
        )}
      </Section>

      {canManageDocTypes && (
        <Section title="Admin">
          <NavLink
            href="/admin/doc-types"
            icon={Layers}
            active={pathname.startsWith("/admin/doc-types")}
            onNavigate={onNavigate}
          >
            Doc types
          </NavLink>
          <NavLink
            href="/admin/option-lists"
            icon={ListTree}
            active={pathname.startsWith("/admin/option-lists")}
            onNavigate={onNavigate}
          >
            Option lists
          </NavLink>
        </Section>
      )}
    </nav>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2 px-2 pb-1">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </div>
  );
}

function NavLink<T extends string>({
  href,
  icon: Icon,
  active,
  indent,
  trailing,
  onNavigate,
  children,
}: {
  href: Route<T>;
  icon?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }> | undefined;
  active: boolean;
  indent?: boolean | undefined;
  trailing?: React.ReactNode | undefined;
  onNavigate?: (() => void) | undefined;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors duration-150",
        indent && "ml-6",
        active
          ? "bg-[var(--muted)] font-medium text-[var(--foreground)]"
          : "text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]",
      )}
    >
      {Icon && <Icon className="size-4 shrink-0" aria-hidden />}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing}
    </Link>
  );
}
