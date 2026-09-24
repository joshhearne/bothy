"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import {
  Bell,
  KeyRound,
  Layers,
  ListTree,
  Palette,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMessages } from "@/i18n/client";

/** The secondary rail. Its selected section is highlighted like the main one. */
export function AdminNav() {
  const pathname = usePathname();
  const t = useMessages();

  const sections: { href: Route; label: string; icon: typeof Users }[] = [
    { href: "/admin/users" as Route, label: t.nav.users, icon: Users },
    { href: "/admin/notifications" as Route, label: t.nav.notifications, icon: Bell },
    { href: "/admin/settings" as Route, label: t.nav.settings, icon: Settings },
    { href: "/admin/branding" as Route, label: t.nav.branding, icon: Palette },
    { href: "/admin/doc-types" as Route, label: t.nav.docTypes, icon: Layers },
    { href: "/admin/option-lists" as Route, label: t.nav.optionLists, icon: ListTree },
    { href: "/admin/api-keys" as Route, label: t.nav.apiKeys, icon: KeyRound },
    { href: "/admin/vault" as Route, label: t.nav.vault, icon: ShieldCheck },
    { href: "/admin/audit" as Route, label: t.nav.auditLog, icon: ScrollText },
  ];

  return (
    <nav aria-label={t.nav.admin} className="md:w-56 md:shrink-0">
      <ul className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
        {sections.map((section) => {
          const active = pathname.startsWith(section.href);
          const Icon = section.icon;

          return (
            <li key={section.href}>
              <Link
                href={section.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors",
                  active
                    ? "bg-[var(--primary)] font-medium text-[var(--primary-foreground)]"
                    : "text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                {section.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
