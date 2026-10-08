"use client";

import * as React from "react";
import { Check, Copy, Speech } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMessages } from "@/i18n/client";
import { copyText } from "@/components/ui/copy-block";
import {
  buildReadback,
  clipboardSafe,
  isCapital,
  parseSecret,
  type SecretToken,
} from "@/lib/secret-text";

const SHOWN_FOR_MS = 1800;

function Char({ token }: { token: SecretToken }) {
  return (
    <span data-kind={token.kind} data-space={token.char === " " || undefined}>
      {token.char}
    </span>
  );
}

/**
 * A secret, character by character, each colored by what it is: letters
 * blue, digits orange, symbols violet, in a monospace face so an l, a 1 and an
 * I take the same width and a different hue. The colors come from the
 * reader's choice on <html> (data-secret-style, see src/lib/secret-style.ts),
 * so this only marks what each character is. The element's text content is
 * exactly the value, so selecting or reading it gives the secret and nothing
 * else.
 */
export function SecretText({ value, className }: { value: string; className?: string }) {
  const tokens = React.useMemo(() => parseSecret(value), [value]);
  return (
    <span className={cn("secret-text font-mono", className)}>
      {tokens.map((token, i) => (
        <Char key={i} token={token} />
      ))}
    </span>
  );
}

/**
 * The spoken form of a secret, for reading it down a phone: "Capital P as in
 * Papa | a as in Alpha | 4 | ! as in Exclamation". Off until asked for, and
 * rendered beside the secret rather than inside it, so whatever holds the
 * secret still contains only the secret.
 */
export function SecretSpellOut({ value, className }: { value: string; className?: string }) {
  const t = useMessages();
  const [open, setOpen] = React.useState(false);
  const [state, setState] = React.useState<"idle" | "copied" | "failed">("idle");
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const tokens = React.useMemo(() => parseSecret(value), [value]);
  const words = { asIn: t.secretText.asIn, capital: t.secretText.capital };

  React.useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  async function onCopy() {
    const ok = await copyText(clipboardSafe(buildReadback(tokens, words)));
    setState(ok ? "copied" : "failed");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), SHOWN_FOR_MS);
  }

  const copied = state === "copied";

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex w-fit items-center gap-1 rounded text-xs text-[var(--muted-foreground)] outline-none hover:text-[var(--foreground)] focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
      >
        <Speech className="size-3.5" aria-hidden />
        {open ? t.secretText.hideSpelling : t.secretText.spellOut}
      </button>

      {open && (
        <div
          aria-label={t.secretText.readback}
          className="secret-text flex flex-col gap-2 rounded-md border bg-[var(--muted)] px-3 py-2 font-mono text-xs leading-7"
        >
          <p className="m-0">
            {tokens.map((token, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span className="text-[var(--border)]"> · </span>}
                <span className="whitespace-nowrap">
                  {token.word !== null && token.kind === "letter" && isCapital(token) && (
                    <span className="text-[var(--muted-foreground)]">{t.secretText.capital} </span>
                  )}
                  <span data-kind={token.kind} className="font-bold">
                    {token.char === " " ? "·" : token.char}
                  </span>
                  {token.word !== null && token.kind !== "digit" && (
                    <>
                      <span className="text-[var(--muted-foreground)]"> {t.secretText.asIn} </span>
                      <span data-kind={token.kind}>{token.word}</span>
                    </>
                  )}
                </span>
              </React.Fragment>
            ))}
          </p>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-2 font-sans">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-[var(--secret-letter)]" aria-hidden />
              {t.secretText.letters}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-[var(--secret-digit)]" aria-hidden />
              {t.secretText.digits}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-[var(--secret-symbol)]" aria-hidden />
              {t.secretText.symbols}
            </span>
            <button
              type="button"
              onClick={() => void onCopy()}
              className={cn(
                "ml-auto inline-flex h-7 items-center gap-1 rounded border bg-[var(--background)] px-2 font-medium outline-none",
                "focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
                copied
                  ? "border-[var(--success)] text-[var(--success)]"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
              )}
            >
              {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
              <span aria-live="polite">
                {copied ? t.common.copied : state === "failed" ? t.common.copyFailed : t.secretText.copyReadback}
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
