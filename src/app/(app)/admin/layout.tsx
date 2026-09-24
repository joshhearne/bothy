import { redirect } from "next/navigation";
import { canManageIntegrations, requireUser } from "@/server/auth/session";
import { getMessages } from "@/i18n/server";
import { AdminNav } from "./admin-nav";

export const dynamic = "force-dynamic";

/**
 * Administration is its own area rather than a section of the rail. There are
 * enough sections that tabs would overflow, so they sit in a secondary rail
 * inset beside the main one.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (!canManageIntegrations(user.role)) redirect("/companies");

  const t = await getMessages();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.nav.admin}</h1>
        <p className="text-sm text-[var(--muted-foreground)]">{t.admin.subtitle}</p>
      </div>

      <div className="flex flex-col gap-6 md:flex-row">
        <AdminNav />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
