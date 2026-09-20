import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { canManageIntegrations, requireUser } from "@/server/auth/session";
import {
  getInstanceBranding,
  LOGO_ACCEPT,
  otherScheme,
  type BrandScheme,
  type Branding,
} from "@/server/services/branding";
import { BrandAccent, BrandMark } from "@/components/brand";
import { getMessages } from "@/i18n/server";
import type { Messages } from "@/i18n";
import { InstanceBrandingForm, LogoForm } from "../branding-forms";
import { removeLogoAction } from "../branding-actions";

export const dynamic = "force-dynamic";

/**
 * One theme's worth of preview. data-theme sets color-scheme for the subtree,
 * so this really is the other theme rather than a picture of it — an admin on
 * light can see what someone on dark gets.
 */
function Preview({
  theme,
  branding,
  t,
}: {
  theme: BrandScheme;
  branding: Branding;
  t: Messages;
}) {
  return (
    <div data-theme={theme} className="flex-1 rounded-lg border bg-[var(--background)] p-4">
      <p className="mb-3 text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
        {theme === "light" ? t.admin.branding.lightMode : t.admin.branding.darkMode}
      </p>

      <BrandAccent brand={branding} className="flex flex-wrap items-center justify-between gap-4">
        <BrandMark branding={branding} fallbackName={t.app.name} className="text-lg" />
        <Button type="button">{t.admin.branding.previewButton}</Button>
      </BrandAccent>
    </div>
  );
}

export default async function BrandingPage() {
  const user = await requireUser();
  if (!canManageIntegrations(user.role)) redirect("/companies");

  const [branding, t] = await Promise.all([getInstanceBranding(), getMessages()]);
  const other = otherScheme(branding.scheme);
  const modeName = (scheme: BrandScheme) =>
    (scheme === "light" ? t.admin.branding.lightMode : t.admin.branding.darkMode).toLowerCase();

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.admin.branding.title}</h1>
        <p className="text-sm text-[var(--muted-foreground)]">{t.admin.branding.subtitle}</p>
      </div>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{t.admin.branding.preview}</h2>
          <p className="text-sm text-[var(--muted-foreground)]">{t.admin.branding.previewHint}</p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <Preview theme="light" branding={branding} t={t} />
          <Preview theme="dark" branding={branding} t={t} />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <InstanceBrandingForm
          name={branding.name}
          scheme={branding.scheme}
          accent={branding.accent}
          altAccent={branding.altAccent}
        />
      </section>

      <section className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <LogoForm
            accept={LOGO_ACCEPT}
            hasLogo={branding.logoUrl !== null}
            slot="primary"
            label={t.admin.branding.logoFor(modeName(branding.scheme))}
            hint={t.admin.branding.logoHint}
          />

          {branding.logoUrl ? (
            <form action={removeLogoAction}>
              <input type="hidden" name="slot" value="primary" />
              <Button type="submit" variant="outline" size="sm">
                {t.admin.branding.remove}
              </Button>
            </form>
          ) : (
            <p className="text-sm text-[var(--muted-foreground)]">{t.admin.branding.noLogo}</p>
          )}
        </div>

        <div className="flex flex-col gap-3 border-t pt-6">
          <LogoForm
            accept={LOGO_ACCEPT}
            hasLogo={branding.altLogoUrl !== null}
            slot="alt"
            label={t.admin.branding.logoFor(modeName(other))}
            hint={t.admin.branding.altLogoHint(modeName(other))}
          />

          {branding.altLogoUrl && (
            <form action={removeLogoAction}>
              <input type="hidden" name="slot" value="alt" />
              <Button type="submit" variant="outline" size="sm">
                {t.admin.branding.remove}
              </Button>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
