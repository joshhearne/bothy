import * as React from "react";
import { cn } from "@/lib/utils";

/** Inline form-level error. Never render raw server messages that could leak internals. */
export function FormError({ children, className }: { children: React.ReactNode; className?: string }) {
  if (!children) return null;
  return (
    <p
      role="alert"
      className={cn("rounded-md border border-[var(--destructive)] px-3 py-2 text-sm text-[var(--destructive)]", className)}
    >
      {children}
    </p>
  );
}
