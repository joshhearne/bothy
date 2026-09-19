import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { AppSidebar } from "@/components/app-sidebar";
import { requireUser } from "@/server/auth/session";
import { canWrite } from "@/server/auth/session";
import { isSetupComplete } from "@/server/services/setup";
import { listCompanies } from "@/server/services/companies";
import { signOutAction } from "@/app/sign-in/actions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!(await isSetupComplete())) redirect("/setup");
  const user = await requireUser();
  const companies = await listCompanies();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between gap-4 border-b px-4 py-3">
        <Link href="/companies" className="text-lg font-semibold tracking-tight">
          Strata
        </Link>
        <div className="flex items-center gap-3">
          <span className="text-sm text-[var(--muted-foreground)]">
            {user.email} · {user.role}
          </span>
          <form action={signOutAction}>
            <Button type="submit" variant="outline" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </header>

      <div className="flex flex-1 flex-col md:flex-row">
        <aside className="shrink-0 border-b md:w-64 md:border-b-0 md:border-r">
          <AppSidebar
            canWrite={canWrite(user.role)}
            companies={companies.map((c) => ({
              id: c.id,
              name: c.name,
              isInternal: c.isInternal,
            }))}
          />
        </aside>
        <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
