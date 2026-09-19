import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { isSetupComplete } from "@/server/services/setup";
import { signOutAction } from "@/app/sign-in/actions";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (!(await isSetupComplete())) redirect("/setup");

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 px-4 py-12">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Strata</h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            Signed in as {session.user.email} ({session.user.role})
          </p>
        </div>
        <form action={signOutAction}>
          <Button type="submit" variant="outline" size="sm">
            Sign out
          </Button>
        </form>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Phase 0 skeleton</CardTitle>
          <CardDescription>
            Database, auth, and the container build are in place. Companies and locations arrive in
            Phase 1.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-[var(--muted-foreground)]">
          See CLAUDE.md for the build phases.
        </CardContent>
      </Card>
    </main>
  );
}
