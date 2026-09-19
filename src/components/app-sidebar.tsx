"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export type SidebarCompany = { id: string; name: string; isInternal: boolean };

export function AppSidebar({
  companies,
  canWrite,
}: {
  companies: SidebarCompany[];
  canWrite: boolean;
}) {
  const pathname = usePathname();

  return (
    <nav aria-label="Companies" className="flex flex-col gap-1 p-3">
      <div className="flex items-center justify-between px-2 pb-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
          Companies
        </span>
        {canWrite && (
          <Link
            href="/companies/new"
            aria-label="New company"
            className="rounded-md p-1 hover:bg-[var(--muted)]"
          >
            <Plus className="size-4" aria-hidden />
          </Link>
        )}
      </div>

      {companies.length === 0 && (
        <p className="px-2 text-sm text-[var(--muted-foreground)]">No companies yet.</p>
      )}

      {companies.map((company) => {
        const href = `/companies/${company.id}` as const;
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={company.id}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
              active ? "bg-[var(--muted)] font-medium" : "hover:bg-[var(--muted)]",
            )}
          >
            <Building2 className="size-4 shrink-0 text-[var(--muted-foreground)]" aria-hidden />
            <span className="truncate">{company.name}</span>
            {company.isInternal && (
              <span className="ml-auto shrink-0 text-[10px] uppercase text-[var(--muted-foreground)]">
                internal
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
