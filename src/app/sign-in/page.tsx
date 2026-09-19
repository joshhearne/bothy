import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { auth, oidcConfigured } from "@/lib/auth";
import { isSetupComplete } from "@/server/services/setup";
import { getMessages } from "@/i18n/server";
import { SignInForm } from "./sign-in-form";

export const dynamic = "force-dynamic";

export default async function SignInPage() {
  if (!(await isSetupComplete())) redirect("/setup");

  const session = await auth.api.getSession({ headers: await headers() });
  if (session) redirect("/");

  const t = await getMessages();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md items-center px-4 py-12">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>{t.signIn.heading}</CardTitle>
          <CardDescription>
            {oidcConfigured ? t.signIn.withSso : t.signIn.localOnly}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignInForm ssoEnabled={oidcConfigured} />
        </CardContent>
      </Card>
    </main>
  );
}
