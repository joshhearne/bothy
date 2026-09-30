import { AppFrame } from "@/components/app-frame";
import { getCompanyScope, requireSession } from "@/server/auth/session";
import { getMessages } from "@/i18n/server";
import { AccountNav } from "./account-nav";

export const dynamic = "force-dynamic";

/**
 * A person's own settings, in the ordinary frame but outside the gate:
 * choosing a password in place of a temporary one, and enrolling a second
 * step, are done here by somebody who has not finished signing in.
 */
export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSession();
  const t = await getMessages();

  return (
    <AppFrame user={user} scope={await getCompanyScope(user)}>
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t.account.title}</h1>
        <AccountNav />
        <div className="min-w-0">{children}</div>
      </div>
    </AppFrame>
  );
}
