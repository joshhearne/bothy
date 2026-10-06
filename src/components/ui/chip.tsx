import * as React from "react";
import { cn } from "@/lib/utils";

export type ChipTone = "green" | "blue" | "yellow" | "gray";

const TONES: Record<ChipTone, string> = {
  green: "border-[var(--success)] bg-[var(--success-muted)] text-[var(--success)]",
  blue: "border-[var(--info)] bg-[var(--info-muted)] text-[var(--info)]",
  yellow: "border-[var(--warning)] bg-[var(--warning-muted)] text-[var(--warning)]",
  gray: "border-[var(--border)] bg-[var(--muted)] text-[var(--muted-foreground)]",
};

/** A small coloured label that says one thing about a row. */
export function Chip({
  tone,
  icon: Icon,
  children,
  className,
}: {
  tone: ChipTone;
  /** A small sign of what the chip says, for a glance before the words. */
  icon?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {Icon && <Icon className="size-3.5 shrink-0" aria-hidden />}
      {children}
    </span>
  );
}

/**
 * A chip with more to say on hover or focus: what the colour stands for, or
 * the list behind the count. No script; the note is in the page and shown
 * by the pointer or the keyboard.
 */
export function ChipWithNote({
  tone,
  icon,
  label,
  note,
}: {
  tone: ChipTone;
  icon?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: React.ReactNode;
  note: React.ReactNode;
}) {
  return (
    <span className="group relative inline-flex">
      <button type="button" className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
        <Chip tone={tone} icon={icon}>
          {label}
        </Chip>
      </button>
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute top-full left-0 z-20 mt-1 hidden w-max max-w-72 rounded-md border bg-[var(--card)] px-3 py-2 text-xs text-[var(--card-foreground)] shadow-md",
          "group-hover:block group-focus-within:block",
        )}
      >
        {note}
      </span>
    </span>
  );
}
