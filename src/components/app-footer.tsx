import {
  LICENSE,
  PRODUCT_NAME,
  SOURCE_URL,
  VENDOR,
  VENDOR_LOGO_DARK,
  VENDOR_LOGO_LIGHT,
  VENDOR_URL,
} from "@/lib/app-meta";
import { getMessages } from "@/i18n/server";
import { getInstanceBranding } from "@/server/services/branding";

/**
 * Two things that are not the same.
 *
 * The credit names the product and who makes it, and travels with the software
 * whoever runs it — an operator may turn it off, which is what the toggle in
 * Admin → Branding does.
 *
 * The licence and the source link stay either way: AGPL-3.0 §13 asks that
 * people using this over a network can get at the source, and that is not an
 * operator's to remove.
 */
export async function AppFooter() {
  const [t, branding] = await Promise.all([getMessages(), getInstanceBranding()]);

  return (
    <footer className="border-t px-4 py-3 text-xs text-[var(--muted-foreground)]">
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {branding.showPoweredBy && (
          <>
            <a
              href={VENDOR_URL}
              rel="noreferrer"
              target="_blank"
              className="inline-flex items-center gap-1.5 hover:underline"
            >
              {/* One mark per theme; CSS shows whichever belongs. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={VENDOR_LOGO_LIGHT}
                alt=""
                data-brand-logo="light"
                className="h-4 w-auto"
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={VENDOR_LOGO_DARK} alt="" data-brand-logo="dark" className="h-4 w-auto" />
              {t.app.poweredBy(PRODUCT_NAME, VENDOR)}
            </a>
            <span aria-hidden>·</span>
          </>
        )}
        {LICENSE} ·{" "}
        <a href={SOURCE_URL} className="underline" rel="noreferrer" target="_blank">
          {t.app.source}
        </a>
      </p>
    </footer>
  );
}
