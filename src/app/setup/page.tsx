import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isSetupComplete } from "@/server/services/setup";
import { MIN_PASSWORD_LENGTH } from "@/server/services/password";
import { getMessages } from "@/i18n/server";
import { SetupForm } from "./setup-form";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (await isSetupComplete()) redirect("/sign-in");
  const t = await getMessages();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md items-center px-4 py-12">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>{t.setup.heading}</CardTitle>
          <CardDescription>{t.setup.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <SetupForm minPasswordLength={MIN_PASSWORD_LENGTH} />
        </CardContent>
      </Card>
    </main>
  );
}
