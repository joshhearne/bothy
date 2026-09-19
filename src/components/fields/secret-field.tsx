"use client";

import { useState } from "react";
import { Eye, EyeOff, KeyRound, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { revealPasswordAction, revealTotpAction } from "@/app/(app)/documents/vault-actions";

/**
 * Read-only view of a secret_ref. Nothing secret is rendered until the viewer
 * asks, and what comes back is held in component state only.
 */
export function SecretField({
  documentId,
  fieldId,
  itemId,
  label,
  username,
  uri,
  webVaultUrl,
  canReveal,
  brokering,
  vaultStatus,
}: {
  documentId: string;
  fieldId: string;
  itemId: string;
  label: string;
  username: string | null;
  uri: string | null;
  webVaultUrl: string | null;
  canReveal: boolean;
  brokering: boolean;
  vaultStatus: string;
}) {
  const [password, setPassword] = useState<string | null>(null);
  const [totp, setTotp] = useState<{ code: string; remaining: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reveal() {
    setBusy(true);
    setError(null);
    const result = await revealPasswordAction(documentId, fieldId, itemId);
    setBusy(false);
    if (result.ok) setPassword(result.value);
    else setError(result.error);
  }

  async function code() {
    setBusy(true);
    setError(null);
    const result = await revealTotpAction(documentId, fieldId, itemId);
    setBusy(false);
    if (result.ok) setTotp({ code: result.value, remaining: result.periodRemaining ?? 0 });
    else setError(result.error);
  }

  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <KeyRound className="size-4 shrink-0 text-[var(--muted-foreground)]" aria-hidden />
        <span className="font-medium">{label}</span>
        {username && <span className="text-[var(--muted-foreground)]">{username}</span>}
        {uri && (
          <a
            href={uri}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-[var(--muted-foreground)] underline"
          >
            {uri}
          </a>
        )}
      </div>

      {!brokering ? (
        <p className="text-[var(--muted-foreground)]">
          {vaultStatus === "locked"
            ? "The vault is locked, so this field is showing a link only."
            : vaultStatus === "unreachable"
              ? "The vault sidecar is unreachable, so this field is showing a link only."
              : "This provider stores links only."}{" "}
          {webVaultUrl && (
            <a
              href={webVaultUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="underline"
            >
              Open in the web vault
            </a>
          )}
        </p>
      ) : !canReveal ? (
        <p className="text-[var(--muted-foreground)]">
          You do not have permission to reveal secrets.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {password === null ? (
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={reveal}>
              <Eye className="size-4" aria-hidden />
              Reveal password
            </Button>
          ) : (
            <>
              <code className="rounded bg-[var(--muted)] px-2 py-1 font-mono">{password}</code>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setPassword(null)}
                aria-label="Hide password"
              >
                <EyeOff className="size-4" aria-hidden />
                Hide
              </Button>
            </>
          )}

          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={code}>
            <Timer className="size-4" aria-hidden />
            {totp ? `${totp.code} · ${totp.remaining}s` : "TOTP"}
          </Button>
        </div>
      )}

      {error && <p className="text-[var(--destructive)]">{error}</p>}
    </div>
  );
}
