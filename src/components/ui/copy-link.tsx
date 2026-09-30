"use client";

import * as React from "react";
import { Check, Link2 } from "lucide-react";
import { copyText } from "@/components/ui/copy-block";
import { cn } from "@/lib/utils";

const SHOWN_FOR_MS = 1800;

/** A small button that puts an address on the clipboard and says so. */
export function CopyLink({
  href,
  label,
  copiedLabel,
  className,
}: {
  href: string;
  label: string;
  copiedLabel: string;
  className?: string;
}) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  async function onCopy() {
    setCopied(await copyText(href));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), SHOWN_FOR_MS);
  }

  return (
    <button
      type="button"
      onClick={() => void onCopy()}
      title={href}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
        copied ? "border-[var(--success)] text-[var(--success)]" : "hover:bg-[var(--muted)]",
        className,
      )}
    >
      {copied ? <Check className="size-4 shrink-0" aria-hidden /> : <Link2 className="size-4 shrink-0" aria-hidden />}
      <span aria-live="polite">{copied ? copiedLabel : label}</span>
    </button>
  );
}
