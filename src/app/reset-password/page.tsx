import { notFound } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BrandMark, brandStyle } from "@/components/brand";
import { AppFooter } from "@/components/app-footer";
import { mailConfigured } from "@/server/mail";
import { getInstanceBranding } from "@/server/services/branding";
import { resetOwner } from "@/server/services/accounts";
import { getMessages } from "@/i18n/server";
import { ResetForm } from "./reset-form";

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  if (!mailConfigured) notFound();
  const params = await searchParams;
  const [t, branding] = await Promise.all([getMessages(), getInstanceBranding()]);
  const token = params.token ?? "";
  const owner = token ? await resetOwner(token) : null;

  return (
    <main
      className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-4 py-12"
      style={brandStyle(branding)}
    >
      <BrandMark branding={branding} fallbackName={t.app.name} className="justify-center text-lg" />
      <Card className="w-full">
        <CardHeader>
          <CardTitle>{t.signIn.resetHeading}</CardTitle>
          <CardDescription>{t.signIn.resetDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          {owner ? (
            <ResetForm token={token} owner={owner} />
          ) : (
            <p className="text-sm text-[var(--destructive)]">{t.signIn.resetExpired}</p>
          )}
        </CardContent>
      </Card>
      <AppFooter />
    </main>
  );
}
