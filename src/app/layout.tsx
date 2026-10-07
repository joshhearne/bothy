import type { Metadata, Viewport } from "next";
import { I18nProvider } from "@/i18n/client";
import { getLocale } from "@/i18n/server";
import { getTheme } from "@/server/theme";
import { getInstanceBranding } from "@/server/services/branding";
import { iconHref } from "@/lib/brand-icon";
import { SURFACE_DARK, SURFACE_LIGHT } from "@/lib/trove-mark";
import { PRODUCT_NAME } from "@/lib/app-meta";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const branding = await getInstanceBranding();

  return {
    title: branding.name?.trim() || PRODUCT_NAME,
    description: "Self-hosted structured IT documentation",
    // A logo doubles as the tab icon; without one the product mark stands, in
    // the instance's accent — both modes' accents, if the operator asked.
    icons: branding.logoUrl
      ? { icon: branding.logoUrl }
      : {
          icon: [{ url: iconHref(branding), type: "image/svg+xml" }],
          apple: [{ url: iconHref(branding, undefined, { png: true, size: 180 }), sizes: "180x180" }],
        },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: SURFACE_LIGHT },
    { media: "(prefers-color-scheme: dark)", color: SURFACE_DARK },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [locale, theme] = await Promise.all([getLocale(), getTheme()]);

  return (
    <html lang={locale} data-theme={theme}>
      <body className="min-h-dvh antialiased">
        <I18nProvider locale={locale}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
