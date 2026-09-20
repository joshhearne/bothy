import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { canManageIntegrations, requireUser } from "@/server/auth/session";
import { getInstanceBranding, LOGO_ACCEPT } from "@/server/services/branding";
import { BrandAccent, BrandMark } from "@/components/brand";
import { getMessages } from "@/i18n/server";
import { InstanceBrandingForm, LogoForm } from "../branding-forms";
import { removeLogoAction } from "../branding-actions";

export const dynamic = "force-dynamic";

export default async function BrandingPage() {
  const user = await requireUser();
  if (!canManageIntegrations(user.role)) redirect("/companies");

  const [branding, t] = await Promise.all([getInstanceBranding(), getMessages()]);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.admin.branding.title}</h1>
        <p className="text-sm text-[var(--muted-foreground)]">{t.admin.branding.subtitle}</p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">{t.admin.branding.preview}</h2>

        {/* The preview is the real thing: same components, same tokens. */}
        <BrandAccent
          accent={branding.accent}
          className="flex max-w-xl flex-wrap items-center justify-between gap-4 rounded-lg border bg-[var(--card)] p-4"
        >
          <BrandMark branding={branding} fallbackName={t.app.name} className="text-lg" />
          <Button type="button">{t.admin.branding.previewButton}</Button>
        </BrandAccent>
      </section>

      <section className="flex flex-col gap-3">
        <InstanceBrandingForm name={branding.name} accent={branding.accent} />
      </section>

      <section className="flex flex-col gap-3">
        <LogoForm accept={LOGO_ACCEPT} hasLogo={branding.logoUrl !== null} />

        {branding.logoUrl ? (
          <form action={removeLogoAction}>
            <Button type="submit" variant="outline" size="sm">
              {t.admin.branding.remove}
            </Button>
          </form>
        ) : (
          <p className="text-sm text-[var(--muted-foreground)]">{t.admin.branding.noLogo}</p>
        )}
      </section>
    </div>
  );
}
