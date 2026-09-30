import { notFound } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BrandMark, brandStyle } from "@/components/brand";
import { AppFooter } from "@/components/app-footer";
import { mailConfigured } from "@/server/mail";
import { getInstanceBranding } from "@/server/services/branding";
import { getMessages } from "@/i18n/server";
import { ForgotForm } from "./forgot-form";

export const dynamic = "force-dynamic";

/** Only where mail is set up; otherwise an administrator sets a temporary password. */
export default async function ForgotPasswordPage() {
  if (!mailConfigured) notFound();
  const [t, branding] = await Promise.all([getMessages(), getInstanceBranding()]);

  return (
    <main
      className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-4 py-12"
      style={brandStyle(branding)}
    >
      <BrandMark branding={branding} fallbackName={t.app.name} className="justify-center text-lg" />
      <Card className="w-full">
        <CardHeader>
          <CardTitle>{t.signIn.forgotHeading}</CardTitle>
          <CardDescription>{t.signIn.forgotDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <ForgotForm />
        </CardContent>
      </Card>
      <AppFooter />
    </main>
  );
}
