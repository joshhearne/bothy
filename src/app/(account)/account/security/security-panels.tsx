"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { startRegistration } from "@simplewebauthn/browser";
import { KeyRound, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/ui/alert";
import { CopyBlock } from "@/components/ui/copy-block";
import { useMessages } from "@/i18n/client";
import {
  addPasskeyAction,
  confirmTotpAction,
  passkeyOptionsAction,
  regenerateRecoveryAction,
  removePasskeyAction,
  removeTotpAction,
  renamePasskeyAction,
  startTotpAction,
  type EnrollState,
} from "../actions";

type Status = {
  totp: { enrolledAt: string } | null;
  passkeys: { id: string; label: string; hardware: boolean; added: string; lastUsed: string | null }[];
  recoveryCodesLeft: number;
  enrolled: boolean;
};

/** Ten codes, shown the one time they can be, until the person says they have them. */
function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const t = useMessages();
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-md border border-[var(--destructive)] p-4">
      <p className="text-sm font-medium">{t.account.recoveryShown}</p>
      <CopyBlock value={codes.join("\n")} label={t.account.recovery} wrap secret />
      <div>
        <Button type="button" onClick={onDone}>
          {t.account.recoveryDone}
        </Button>
      </div>
    </div>
  );
}

export function SecurityPanels({
  status,
  mustKeepOne,
  afterFirst,
}: {
  status: Status;
  /** Administrators cannot remove their last factor. */
  mustKeepOne: boolean;
  /** Where to go once the first factor is enrolled, when sign-in was waiting on it. */
  afterFirst: string | null;
}) {
  const t = useMessages();
  const router = useRouter();
  const [codes, setCodes] = useState<string[] | null>(null);
  const factors = (status.totp ? 1 : 0) + status.passkeys.length;
  const canRemove = !mustKeepOne || factors > 1;

  function shown(recoveryCodes: string[] | null | undefined) {
    if (recoveryCodes && recoveryCodes.length > 0) setCodes(recoveryCodes);
    else if (afterFirst) router.push(afterFirst as Route);
  }

  function done() {
    setCodes(null);
    if (afterFirst) router.push(afterFirst as Route);
    else router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      {codes && <RecoveryCodes codes={codes} onDone={done} />}

      <TotpPanel status={status} canRemove={canRemove} onEnrolled={shown} />
      <PasskeyPanel status={status} canRemove={canRemove} onEnrolled={shown} />

      {status.enrolled && (
        <section className="flex flex-col gap-3 rounded-md border p-4">
          <div>
            <h3 className="font-medium">{t.account.recovery}</h3>
            <p className="text-sm text-[var(--muted-foreground)]">{t.account.recoveryHint}</p>
          </div>
          <p className="text-sm">
            {status.recoveryCodesLeft === 0
              ? t.account.recoveryNone
              : t.account.recoveryLeft(status.recoveryCodesLeft)}
          </p>
          <RegenerateButton onCodes={(fresh) => setCodes(fresh)} />
        </section>
      )}

      {mustKeepOne && status.enrolled && !canRemove && (
        <p className="text-xs text-[var(--muted-foreground)]">{t.account.adminNeedsOne}</p>
      )}
    </div>
  );
}

function RegenerateButton({ onCodes }: { onCodes: (codes: string[]) => void }) {
  const t = useMessages();
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-3">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => start(async () => onCodes((await regenerateRecoveryAction()).recoveryCodes))}
      >
        {t.account.recoveryMake}
      </Button>
      <span className="text-xs text-[var(--muted-foreground)]">{t.account.recoveryMakeHint}</span>
    </div>
  );
}

function TotpPanel({
  status,
  canRemove,
  onEnrolled,
}: {
  status: Status;
  canRemove: boolean;
  onEnrolled: (codes: string[] | null | undefined) => void;
}) {
  const t = useMessages();
  const [state, confirm, confirming] = useActionState<EnrollState, FormData>(
    async (prev, formData) => {
      const next = await confirmTotpAction(prev, formData);
      if (next.ok) onEnrolled(next.recoveryCodes);
      return next;
    },
    {},
  );
  const [enrollment, setEnrollment] = useState<EnrollState["enrollment"] | null>(null);
  const [starting, start] = useTransition();

  return (
    <section className="flex flex-col gap-3 rounded-md border p-4">
      <div className="flex items-start gap-3">
        <Smartphone className="mt-1 size-4 shrink-0 text-[var(--muted-foreground)]" aria-hidden />
        <div className="min-w-0 flex-1">
          <h3 className="font-medium">{t.account.totp}</h3>
          <p className="text-sm text-[var(--muted-foreground)]">{t.account.totpHint}</p>
        </div>
      </div>

      {status.totp ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm">{t.account.totpEnrolled(status.totp.enrolledAt)}</span>
          {canRemove && (
            <form action={removeTotpAction}>
              <Button type="submit" variant="outline" size="sm" title={t.account.totpRemoveHint}>
                {t.account.totpRemove}
              </Button>
            </form>
          )}
        </div>
      ) : enrollment && !state.ok ? (
        <form action={confirm} className="flex flex-col gap-3">
          <FormError>{state.error}</FormError>
          <p className="text-sm">{t.account.totpScan}</p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <div
              className="w-44 shrink-0 rounded-md bg-white p-2"
              dangerouslySetInnerHTML={{ __html: enrollment.qrSvg }}
            />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-[var(--muted-foreground)]">{t.account.totpKey}</p>
              <CopyBlock value={enrollment.secret.replace(/(.{4})/g, "$1 ").trim()} label={t.account.totpKey} wrap spellOut />
            </div>
          </div>
          <Label htmlFor="totp-code">{t.account.totpConfirm}</Label>
          <div className="flex flex-wrap items-center gap-3">
            <Input
              id="totp-code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]{6,7}"
              required
              className="w-40 font-mono tracking-widest"
              aria-invalid={state.fieldErrors?.code ? true : undefined}
            />
            <Button type="submit" disabled={confirming}>
              {confirming ? t.mfa.verifying : t.account.totpConfirmSubmit}
            </Button>
          </div>
          {state.fieldErrors?.code && (
            <p className="text-sm text-[var(--destructive)]">{state.fieldErrors.code}</p>
          )}
        </form>
      ) : (
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={starting}
            onClick={() => start(async () => setEnrollment((await startTotpAction()).enrollment ?? null))}
          >
            {t.account.totpSetUp}
          </Button>
        </div>
      )}
    </section>
  );
}

function PasskeyPanel({
  status,
  canRemove,
  onEnrolled,
}: {
  status: Status;
  canRemove: boolean;
  onEnrolled: (codes: string[] | null | undefined) => void;
}) {
  const t = useMessages();
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const supported = typeof window === "undefined" || "PublicKeyCredential" in window;

  function add() {
    setError(null);
    start(async () => {
      try {
        const options = await passkeyOptionsAction();
        const response = await startRegistration({
          optionsJSON: options as Parameters<typeof startRegistration>[0]["optionsJSON"],
        });
        const result = await addPasskeyAction(response, label);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setLabel("");
        router.refresh();
        onEnrolled(result.recoveryCodes);
      } catch {
        setError(t.account.passkeyFailed);
      }
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-md border p-4">
      <div className="flex items-start gap-3">
        <KeyRound className="mt-1 size-4 shrink-0 text-[var(--muted-foreground)]" aria-hidden />
        <div className="min-w-0 flex-1">
          <h3 className="font-medium">{t.account.passkeys}</h3>
          <p className="text-sm text-[var(--muted-foreground)]">{t.account.passkeysHint}</p>
        </div>
      </div>

      {status.passkeys.length > 0 && (
        <ul className="flex flex-col divide-y rounded-md border">
          {status.passkeys.map((passkey) => (
            <li key={passkey.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium break-words">{passkey.label}</p>
                <p className="text-xs text-[var(--muted-foreground)]">
                  {[
                    passkey.hardware ? t.account.hardware : t.account.software,
                    t.account.passkeyAdded(passkey.added),
                    passkey.lastUsed ? t.account.passkeyUsed(passkey.lastUsed) : t.account.passkeyNeverUsed,
                  ].join(" · ")}
                </p>
              </div>
              <form action={renamePasskeyAction} className="flex items-center gap-2">
                <input type="hidden" name="id" value={passkey.id} />
                <label className="sr-only" htmlFor={`label-${passkey.id}`}>
                  {t.account.passkeyLabel}
                </label>
                <Input
                  id={`label-${passkey.id}`}
                  name="label"
                  defaultValue={passkey.label}
                  maxLength={100}
                  className="h-8 w-40 text-sm"
                />
                <Button type="submit" variant="ghost" size="sm">
                  {t.account.passkeyRename}
                </Button>
              </form>
              {(canRemove || status.passkeys.length > 1 || status.totp) && (
                <form action={removePasskeyAction}>
                  <input type="hidden" name="id" value={passkey.id} />
                  <Button type="submit" variant="outline" size="sm">
                    {t.account.passkeyRemove}
                  </Button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      {supported ? (
        <div className="flex flex-col gap-2">
          <FormError>{error}</FormError>
          <Label htmlFor="new-passkey-label">{t.account.passkeyLabel}</Label>
          <div className="flex flex-wrap items-center gap-3">
            <Input
              id="new-passkey-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              maxLength={100}
              placeholder={t.account.passkeyLabelHint}
              className="w-64"
            />
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={add}>
              {busy ? t.account.passkeyAdding : t.account.passkeyAdd}
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-[var(--muted-foreground)]">{t.account.passkeyUnsupported}</p>
      )}
    </section>
  );
}
