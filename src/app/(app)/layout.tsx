import { redirect } from "next/navigation";
import { AppFrame } from "@/components/app-frame";
import { requireScopedUser } from "@/server/auth/session";
import { isSetupComplete } from "@/server/services/setup";

export const dynamic = "force-dynamic";

/** Everything here needs a person who has finished signing in. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!(await isSetupComplete())) redirect("/setup");
  const { user, scope } = await requireScopedUser();
  return (
    <AppFrame user={user} scope={scope}>
      {children}
    </AppFrame>
  );
}
