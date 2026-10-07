import type { Metadata, Viewport } from "next";
import { I18nProvider } from "@/i18n/client";
import { getLocale } from "@/i18n/server";
import { getTheme } from "@/server/theme";
import { getInstanceBranding } from "@/server/services/branding";
import { brandTokens } from "@/lib/brand-color";
import { DEFAULT_ACCENT_LIGHT, SURFACE_DARK, SURFACE_LIGHT } from "@/lib/trove-mark";
import { PRODUCT_NAME } from "@/lib/app-meta";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const branding = await getInstanceBranding();
  // The product mark in the instance's accent; the address changes with it.
  const accent = (brandTokens(branding)?.light ?? DEFAULT_ACCENT_LIGHT).slice(1);

  return {
    title: branding.name?.trim() || PRODUCT_NAME,
    description: "Self-hosted structured IT documentation",
    // A logo doubles as the tab icon; without one the product mark stands.
    icons: branding.logoUrl
      ? { icon: branding.logoUrl }
      : {
          icon: [{ url: `/api/branding/icon?v=${accent}`, type: "image/svg+xml" }],
          apple: [{ url: `/api/branding/icon?format=png&size=180&v=${accent}`, sizes: "180x180" }],
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
