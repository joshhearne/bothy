import * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "flex h-10 w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none",
        "placeholder:text-[var(--muted-foreground)]",
        "focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-[invalid=true]:border-[var(--destructive)]",
        className,
      )}
      {...props}
    />
  );
}
