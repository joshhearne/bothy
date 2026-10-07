import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { canManageIntegrations, requireUser } from "@/server/auth/session";
import {
  getInstanceBranding,
  LOGO_ACCEPT,
  type BrandScheme,
  type Branding,
} from "@/server/services/branding";
import { BrandAccent, BrandMark } from "@/components/brand";
import { iconHref } from "@/lib/brand-icon";
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
function Preview({ theme, branding, t }: { theme: BrandScheme; branding: Branding; t: Messages }) {
  return (
    <div data-theme={theme} className="rounded-lg border bg-[var(--background)] p-4">
      <p className="mb-3 text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
        {theme === "light" ? t.admin.branding.lightMode : t.admin.branding.darkMode}
      </p>

      <BrandAccent brand={branding} className="flex flex-wrap items-center justify-between gap-4">
        <BrandMark branding={branding} fallbackName={t.app.name} className="text-lg" />
        <Button type="button">{t.admin.branding.previewButton}</Button>
      </BrandAccent>

      {/* The tab icon a browser in this mode would show: the logo, or the mark on its tile. */}
      <p className="mt-4 flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={branding.logoUrl ?? iconHref(branding, theme)}
          alt=""
          data-tab-icon
          className="size-4 rounded-sm object-contain"
        />
        {t.admin.branding.tabIcon}
      </p>
    </div>
  );
}

/**
 * One mode's logo: the upload, and the logo as that mode shows it, drawn in
 * that mode so a white-on-transparent mark is seen against the dark it is for.
 */
function LogoPanel({
  theme,
  slot,
  url,
  t,
}: {
  theme: BrandScheme;
  slot: "primary" | "alt";
  url: string | null;
  t: Messages;
}) {
  const mode = (theme === "light" ? t.admin.branding.lightMode : t.admin.branding.darkMode).toLowerCase();
  return (
    <div className="flex flex-col gap-3">
      <LogoForm
        accept={LOGO_ACCEPT}
        hasLogo={url !== null}
        slot={slot}
        label={t.admin.branding.logoFor(mode)}
        hint={theme === "light" ? t.admin.branding.logoHint : t.admin.branding.altLogoHint(mode)}
      />
      {url ? (
        <>
          <div
            data-theme={theme}
            className="flex items-center justify-center rounded-lg border bg-[var(--background)] p-4"
          >
            {/* Our own route, serving an image of unknown dimensions. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={t.admin.branding.currentLogo(mode)} className="h-12 w-auto max-w-full object-contain" />
          </div>
          <form action={removeLogoAction}>
            <input type="hidden" name="slot" value={slot} />
            <Button type="submit" variant="outline" size="sm">
              {t.admin.branding.remove}
            </Button>
          </form>
        </>
      ) : (
        <p className="text-sm text-[var(--muted-foreground)]">{t.admin.branding.noLogo}</p>
      )}
    </div>
  );
}

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

      <InstanceBrandingForm
        name={branding.name}
        accent={branding.accent}
        altAccent={branding.altAccent}
        accentText={branding.accentText}
        altAccentText={branding.altAccentText}
        showPoweredBy={branding.showPoweredBy}
        iconFollowsMode={branding.iconFollowsMode}
        previews={[
          <Preview key="light" theme="light" branding={branding} t={t} />,
          <Preview key="dark" theme="dark" branding={branding} t={t} />,
        ]}
        logos={[
          <LogoPanel key="light" theme="light" slot="primary" url={branding.logoUrl} t={t} />,
          <LogoPanel key="dark" theme="dark" slot="alt" url={branding.altLogoUrl} t={t} />,
        ]}
      />
    </div>
  );
}
