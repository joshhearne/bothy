import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { canManageDocTypes, canManageHierarchy, requireUser } from "@/server/auth/session";
import { isSetupComplete } from "@/server/services/setup";
import { listCompanies } from "@/server/services/companies";
import { signOutAction } from "@/app/sign-in/actions";
import { getTheme } from "@/server/theme";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!(await isSetupComplete())) redirect("/setup");
  const user = await requireUser();
  const companies = await listCompanies();
  const theme = await getTheme();

  return (
    <AppShell
      user={{ name: user.name, email: user.email, role: user.role }}
      canCreateCompanies={canManageHierarchy(user.role)}
      canManageDocTypes={canManageDocTypes(user.role)}
      theme={theme}
      signOut={signOutAction}
      companies={companies.map((company) => ({
        id: company.id,
        name: company.name,
        isInternal: company.isInternal,
      }))}
    >
      {children}
    </AppShell>
  );
}
