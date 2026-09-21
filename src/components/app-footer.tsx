import { LICENSE, PRODUCT_NAME, SOURCE_URL } from "@/lib/app-meta";
import { getMessages } from "@/i18n/server";
import { getInstanceBranding } from "@/server/services/branding";

/**
 * The notice an operator does not brand away. The name above may be theirs;
 * this says what the software is and where its source lives, which is what
 * AGPL-3.0 §13 asks of anything people use over a network.
 */
export async function AppFooter() {
  const [t, branding] = await Promise.all([getMessages(), getInstanceBranding()]);
  const operator = branding.name?.trim();

  return (
    <footer className="border-t px-4 py-3 text-xs text-[var(--muted-foreground)]">
      <p>
        {operator ? t.app.poweredByFor(PRODUCT_NAME, operator) : t.app.poweredBy(PRODUCT_NAME)} ·{" "}
        {LICENSE} ·{" "}
        <a href={SOURCE_URL} className="underline" rel="noreferrer" target="_blank">
          {t.app.source}
        </a>
      </p>
    </footer>
  );
}
