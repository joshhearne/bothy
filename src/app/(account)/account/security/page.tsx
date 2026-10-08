import { requireSession } from "@/server/auth/session";
import { mfaDeadline, mfaStatus } from "@/server/services/mfa";
import { formatDateTime } from "@/i18n/format";
import { getI18n } from "@/i18n/server";
import { SecurityPanels } from "./security-panels";
import { isAdministrator } from "@/server/auth/roles";

export const dynamic = "force-dynamic";

export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ required?: string }>;
}) {
  const user = await requireSession();
  const [status, { locale, messages: t }] = await Promise.all([mfaStatus(user.id), getI18n()]);
  const forced = (await searchParams).required === "1";

  const due = isAdministrator(user.role) && !status.enrolled ? await mfaDeadline(user.id) : null;
  const deadline = due?.deadline ?? null;
  const overdue = due?.overdue ?? false;

  const notice =
    overdue || forced
      ? t.account.mfaOverdue
      : deadline
        ? t.account.mfaRequired(formatDateTime(deadline, locale))
        : status.enrolled
          ? null
          : t.account.mfaEncouraged;

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{t.account.mfaTitle}</h2>
        <p className="text-sm text-[var(--muted-foreground)]">{t.account.mfaHint}</p>
      </div>

      {notice && (
        <p
          role="note"
          className={
            overdue || forced
              ? "rounded-md border border-[var(--destructive)] px-3 py-2 text-sm"
              : "rounded-md border px-3 py-2 text-sm"
          }
        >
          {notice}
        </p>
      )}

      <SecurityPanels
        status={{
          totp: status.totp
            ? { enrolledAt: formatDateTime(status.totp.enrolledAt, locale) }
            : null,
          passkeys: status.passkeys.map((passkey) => ({
            id: passkey.id,
            label: passkey.label,
            hardware: passkey.deviceType === "singleDevice",
            added: formatDateTime(passkey.createdAt, locale),
            lastUsed: passkey.lastUsedAt ? formatDateTime(passkey.lastUsedAt, locale) : null,
          })),
          recoveryCodesLeft: status.recoveryCodesLeft,
          enrolled: status.enrolled,
        }}
        mustKeepOne={isAdministrator(user.role)}
        afterFirst={forced || overdue ? "/" : null}
      />
    </div>
  );
}
