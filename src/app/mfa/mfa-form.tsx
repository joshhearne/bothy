"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { startAuthentication } from "@simplewebauthn/browser";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/ui/alert";
import { useMessages } from "@/i18n/client";
import { passkeyChallengeAction, verifyCodeAction, verifyPasskeyAction, type MfaState } from "./actions";

export function MfaForm({
  next,
  hasTotp,
  hasPasskeys,
  hasRecovery,
  signOut,
}: {
  next: string;
  hasTotp: boolean;
  hasPasskeys: boolean;
  hasRecovery: boolean;
  signOut: () => Promise<void>;
}) {
  const t = useMessages();
  const router = useRouter();
  const [state, formAction, pending] = useActionState<MfaState, FormData>(verifyCodeAction, {});
  const [recovery, setRecovery] = useState(!hasTotp);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [waiting, start] = useTransition();
  const supported = typeof window === "undefined" || "PublicKeyCredential" in window;

  function tryPasskey() {
    setPasskeyError(null);
    start(async () => {
      try {
        const options = await passkeyChallengeAction();
        if (!options) return;
        const response = await startAuthentication({
          optionsJSON: options as Parameters<typeof startAuthentication>[0]["optionsJSON"],
        });
        const result = await verifyPasskeyAction(response);
        if (result.ok) router.replace(next as Route);
        else setPasskeyError(result.error || t.mfa.passkeyFailed);
      } catch {
        setPasskeyError(t.mfa.passkeyFailed);
      }
    });
  }

  // A passkey is the quicker way, so it is offered first, without a click.
  const offered = useRef(false);
  useEffect(() => {
    if (offered.current || !hasPasskeys || !supported) return;
    offered.current = true;
    const timer = setTimeout(tryPasskey, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-4">
      {hasPasskeys && supported && (
        <>
          <FormError>{passkeyError}</FormError>
          <Button type="button" variant="outline" className="w-full" disabled={waiting} onClick={tryPasskey}>
            <KeyRound className="size-4" aria-hidden />
            {waiting ? t.mfa.passkeyWaiting : t.mfa.usePasskey}
          </Button>
          {(hasTotp || hasRecovery) && (
            <div className="flex items-center gap-3 text-xs text-[var(--muted-foreground)]">
              <span className="h-px flex-1 bg-[var(--border)]" />
              {t.signIn.orLocal.replace("a local account", recovery ? t.mfa.recoveryCode.toLowerCase() : t.mfa.code.toLowerCase())}
              <span className="h-px flex-1 bg-[var(--border)]" />
            </div>
          )}
        </>
      )}

      {(hasTotp || hasRecovery) && (
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="next" value={next} />
          <input type="hidden" name="method" value={recovery ? "recovery" : "totp"} />
          <FormError>{state.error}</FormError>
          <div className="flex flex-col gap-2">
            <Label htmlFor="code">{recovery ? t.mfa.recoveryCode : t.mfa.code}</Label>
            <Input
              id="code"
              name="code"
              inputMode={recovery ? "text" : "numeric"}
              autoComplete="one-time-code"
              autoFocus={!hasPasskeys}
              required
              className="font-mono tracking-widest"
            />
          </div>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? t.mfa.verifying : t.mfa.verify}
          </Button>
          {hasTotp && hasRecovery && (
            <button
              type="button"
              onClick={() => setRecovery((was) => !was)}
              className="text-sm text-[var(--muted-foreground)] underline"
            >
              {recovery ? t.mfa.code : t.mfa.useRecovery}
            </button>
          )}
        </form>
      )}

      <form action={signOut} className="text-center">
        <button type="submit" className="text-sm text-[var(--muted-foreground)] underline">
          {t.mfa.signOut}
        </button>
      </form>
    </div>
  );
}
