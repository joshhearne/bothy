import { requireSession } from "@/server/auth/session";
import { getMessages } from "@/i18n/server";
import { PasswordForm } from "./password-form";

export const dynamic = "force-dynamic";

export default async function PasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ required?: string }>;
}) {
  const user = await requireSession();
  const t = await getMessages();
  const required = (await searchParams).required === "1" || user.mustChangePassword;

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{t.account.password}</h2>
        <p className="text-sm text-[var(--muted-foreground)]">{t.account.passwordHint}</p>
      </div>
      {required && (
        <p role="note" className="rounded-md border border-[var(--destructive)] px-3 py-2 text-sm">
          {t.account.passwordRequired}
        </p>
      )}
      <PasswordForm owner={{ email: user.email, name: user.name }} required={required} />
    </div>
  );
}
