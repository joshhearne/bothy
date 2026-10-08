"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMessages } from "@/i18n/client";
import { SecretSpellOut, SecretText } from "@/components/ui/secret-text";

const SHOWN_FOR_MS = 1800;

/** The clipboard API needs https; the fallback is for an instance still on http. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Refused, or not allowed here: try the older way.
  }

  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
  }
}

/**
 * Text somebody is about to paste somewhere else: a key, a command, a block
 * of instructions. Clicking anywhere on it copies it, and it says so — the
 * block turns green and the corner reads "Copied" for a moment — because
 * a copy that gives no sign leaves people doing it twice to be sure.
 */
export function CopyBlock({
  value,
  label,
  wrap = false,
  secret = false,
  spellOut = false,
  className,
}: {
  /** Exactly what lands on the clipboard. */
  value: string;
  /** What this is, for a screen reader. */
  label: string;
  /** Wrap long lines, for prose. Commands and keys scroll instead. */
  wrap?: boolean;
  /** A key, a code, a password: color each character by what it is. */
  secret?: boolean;
  /** Offer the spoken form too, for reading it down a phone. Implies secret. */
  spellOut?: boolean;
  className?: string;
}) {
  const t = useMessages();
  const [state, setState] = React.useState<"idle" | "copied" | "failed">("idle");
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  async function onCopy() {
    // Somebody dragging across part of it wants that part, not all of it.
    if ((window.getSelection()?.toString() ?? "") !== "") return;

    setState((await copyText(value)) ? "copied" : "failed");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), SHOWN_FOR_MS);
  }

  const copied = state === "copied";

  return (
    <div
      data-copied={copied || undefined}
      className={cn(
        "group relative rounded-md border bg-[var(--muted)] transition-colors duration-200",
        copied && "border-[var(--success)] bg-[var(--success-muted)]",
        state === "failed" && "border-[var(--destructive)]",
        className,
      )}
    >
      <output
        aria-label={label}
        onClick={() => void onCopy()}
        title={t.common.copyHint}
        className={cn(
          "block cursor-copy px-3 py-2 pr-24 font-mono text-xs",
          wrap ? "break-words whitespace-pre-wrap" : "overflow-x-auto whitespace-pre",
        )}
      >
        {secret || spellOut ? <SecretText value={value} /> : value}
      </output>

      {spellOut && <SecretSpellOut value={value} className="border-t px-3 py-2" />}

      <button
        type="button"
        onClick={() => void onCopy()}
        className={cn(
          "absolute top-1.5 right-1.5 inline-flex h-7 items-center gap-1 rounded border bg-[var(--background)] px-2 text-xs font-medium outline-none",
          "focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
          copied
            ? "border-[var(--success)] text-[var(--success)]"
            : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
        )}
      >
        {copied ? (
          <Check className="size-3.5" aria-hidden />
        ) : (
          <Copy className="size-3.5" aria-hidden />
        )}
        <span aria-live="polite">
          {copied ? t.common.copied : state === "failed" ? t.common.copyFailed : t.common.copy}
        </span>
      </button>
    </div>
  );
}
