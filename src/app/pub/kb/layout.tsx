import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark, brandStyle } from "@/components/brand";
import { AppFooter } from "@/components/app-footer";
import { getInstanceBranding } from "@/server/services/branding";
import { requirePublicReader, visitorCompany } from "@/server/kb/public";
import { getMessages } from "@/i18n/server";

export const dynamic = "force-dynamic";

/** Read by the people it is for, not by a search engine. */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * The public knowledge base: the collections an operator put here, for readers
 * who have not signed in. It has no navigation into the rest of the
 * installation, because there is nothing there for them.
 */
export default async function PublicKbLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePublicReader();
  const [branding, t, company] = await Promise.all([
    getInstanceBranding(),
    getMessages(),
    visitorCompany(),
  ]);

  return (
    <div className="flex min-h-dvh flex-col" style={brandStyle(branding)}>
      <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b bg-[var(--background)] px-4">
        <Link href="/pub/kb" className="flex min-w-0 items-center gap-3">
          {/* The visitor's own company, in the corner: a curated view, not a different site. */}
          {company?.logoVersion && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/pub/kb/company-logo?v=${company.logoVersion}`}
              alt={company.name}
              className="h-8 w-auto max-w-40 object-contain"
            />
          )}
          <BrandMark branding={branding} fallbackName={t.app.name} />
          <span className="truncate border-l pl-3 text-sm text-[var(--muted-foreground)]">
            {t.kb.title}
          </span>
        </Link>
      </header>

      <main className="mx-auto w-full max-w-6xl min-w-0 flex-1 p-4 md:p-8">
        {children}
      </main>
      <AppFooter site="kb" />
    </div>
  );
}
