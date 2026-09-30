import { redirect } from "next/navigation";
import type { Route } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BrandMark, brandStyle } from "@/components/brand";
import { AppFooter } from "@/components/app-footer";
import { requireSession } from "@/server/auth/session";
import { mfaStatus } from "@/server/services/mfa";
import { getInstanceBranding } from "@/server/services/branding";
import { signOutAction } from "@/app/sign-in/actions";
import { getMessages } from "@/i18n/server";
import { MfaForm } from "./mfa-form";

export const dynamic = "force-dynamic";

/**
 * The second step, on its own page like sign-in: nothing of the site shows
 * until it is passed. Reached fresh after the password, and again from the
 * sensitive pages when the last pass was a while ago.
 */
export default async function MfaPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; again?: string }>;
}) {
  const user = await requireSession();
  const params = await searchParams;
  const next = params.next && params.next.startsWith("/") && !params.next.startsWith("//") ? params.next : "/";

  const status = await mfaStatus(user.id);
  // Nothing enrolled means nothing to ask; only the gate sends people here.
  if (!status.enrolled) redirect(next as Route);
  if (user.mfa.verifiedAt && params.again !== "1") redirect(next as Route);

  const [t, branding] = await Promise.all([getMessages(), getInstanceBranding()]);

  return (
    <main
      className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-4 py-12"
      style={brandStyle(branding)}
    >
      <BrandMark branding={branding} fallbackName={t.app.name} className="justify-center text-lg" />
      <Card className="w-full">
        <CardHeader>
          <CardTitle>{t.mfa.heading}</CardTitle>
          <CardDescription>{params.again === "1" ? t.mfa.again : t.mfa.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <MfaForm
            next={next}
            hasTotp={status.totp !== null}
            hasPasskeys={status.passkeys.length > 0}
            hasRecovery={status.recoveryCodesLeft > 0}
            signOut={signOutAction}
          />
        </CardContent>
      </Card>
      <AppFooter />
    </main>
  );
}
