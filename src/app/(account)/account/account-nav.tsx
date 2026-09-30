"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useMessages } from "@/i18n/client";

/** Two sections: a top tab rail is enough. */
export function AccountNav() {
  const pathname = usePathname();
  const t = useMessages();
  const tabs: { href: Route; label: string }[] = [
    { href: "/account/security" as Route, label: t.account.security },
    { href: "/account/password" as Route, label: t.account.password },
  ];
  return (
    <nav aria-label={t.account.title} className="flex gap-1 border-b">
      {tabs.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm",
              active
                ? "border-[var(--primary)] font-medium text-[var(--foreground)]"
                : "border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
