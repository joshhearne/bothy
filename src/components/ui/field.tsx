import * as React from "react";
import { Label } from "@/components/ui/label";

/** Label + control + inline error, the shape every form on the site uses. */
export function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && !error && <p className="text-xs text-[var(--muted-foreground)]">{hint}</p>}
      {error && (
        <p id={`${id}-error`} className="text-sm text-[var(--destructive)]">
          {error}
        </p>
      )}
    </div>
  );
}
