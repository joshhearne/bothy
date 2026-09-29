import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { listAllCollections } from "@/server/services/kb";
import { listCompanies } from "@/server/services/companies";
import { ALL_COMPANIES } from "@/server/auth/company-scope";
import { getKbPublicSettings } from "@/server/services/settings";
import { plural } from "@/i18n/format";
import { getI18n } from "@/i18n/server";
import { CollectionForm } from "../kb-forms";

export const dynamic = "force-dynamic";

/** Every collection, archived ones included, and the form that adds one. */
export default async function KbAdminPage() {
  await requireUser();
  const [collections, companies, publicSite, { locale, messages: t }] = await Promise.all([
    listAllCollections(),
    listCompanies(ALL_COMPANIES),
    getKbPublicSettings(),
    getI18n(),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{t.admin.kb.title}</h2>
        <p className="text-sm text-[var(--muted-foreground)]">{t.admin.kb.subtitle}</p>
      </div>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">{t.admin.kb.collections}</h3>
        {collections.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">{t.admin.kb.empty}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {collections.map((collection) => (
              <li
                key={collection.id}
                className="flex flex-wrap items-center gap-3 rounded-md border px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium break-words">
                    {collection.name}
                    {collection.archivedAt && (
                      <span className="ml-2 text-xs font-normal text-[var(--muted-foreground)]">
                        {t.common.archived}
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-[var(--muted-foreground)]">
                    {t.admin.kb.summary(
                      plural(collection.articleCount, t.units.article, t.units.articles, locale),
                      collection.unextractedCount,
                    )}
                    {" · "}
                    {collection.allCompanies ? t.admin.kb.forEveryone : t.admin.kb.forSome}
                    {collection.publicAccess ? ` · ${t.admin.kb.onPublicSite}` : ""}
                  </p>
                </div>
                <Link href={`/kb/${collection.id}`} className="text-sm underline">
                  {t.admin.kb.view}
                </Link>
                <Link
                  href={`/admin/kb/${collection.id}`}
                  className="rounded-md border px-3 py-1.5 text-sm hover:bg-[var(--muted)]"
                >
                  {t.admin.kb.manage}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">{t.admin.kb.newCollection}</h3>
        <CollectionForm
          publicSiteOn={publicSite.mode !== "off"}
          companies={companies.map((company) => ({ id: company.id, name: company.name }))}
        />
      </section>
    </div>
  );
}
