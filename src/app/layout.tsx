import type { Metadata } from "next";
import { I18nProvider } from "@/i18n/client";
import { getLocale } from "@/i18n/server";
import { getTheme } from "@/server/theme";
import { getInstanceBranding } from "@/server/services/branding";
import { PRODUCT_NAME } from "@/lib/app-meta";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const branding = await getInstanceBranding();

  return {
    title: branding.name?.trim() || PRODUCT_NAME,
    description: "Self-hosted structured IT documentation",
    // A logo doubles as the tab icon; without one the default favicon stands.
    ...(branding.logoUrl ? { icons: { icon: branding.logoUrl } } : {}),
  };
}

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
