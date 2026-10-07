import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { collectionCompanyNames, listAllCollections } from "@/server/services/kb";
import { Chip, ChipWithNote } from "@/components/ui/chip";
import { EyeOff, Globe, GlobeLock } from "lucide-react";
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
  const [collections, companyNames, companies, publicSite, { locale, messages: t }] = await Promise.all([
    listAllCollections(),
    collectionCompanyNames(),
    listCompanies(ALL_COMPANIES),
    getKbPublicSettings(),
    getI18n(),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{t.admin.kb.title}</h2>
        <p className="text-sm text-[var(--muted-foreground)]">{t.admin.kb.subtitle}</p>
        <Link href="/admin/kb/access" className="text-sm underline">
          {t.admin.kb.accessLink}
        </Link>
      </div>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">{t.admin.kb.collections}</h3>
        {collections.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">{t.admin.kb.empty}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {/* The labels line up with the rows on a wide screen; on a phone the rows explain themselves. */}
            <div
              aria-hidden
              className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-3 px-4 text-xs text-[var(--muted-foreground)] md:grid"
            >
              <span>{t.admin.kb.columns.collection}</span>
              <span>{t.admin.kb.columns.articles}</span>
              <span>{t.admin.kb.columns.companies}</span>
              <span>{t.admin.kb.columns.visibility}</span>
              <span className="text-right">{t.admin.kb.columns.management}</span>
            </div>

            <ul className="flex flex-col gap-2">
              {collections.map((collection) => {
                const names = companyNames.get(collection.id) ?? [];
                const siteOn = publicSite.mode !== "off";
                // A globe for what the public can read, a padlocked one when some of it is held back.
                const visibility: {
                  tone: "green" | "yellow" | "blue";
                  icon: typeof Globe;
                  label: string;
                  note: string;
                } = !siteOn
                  ? { tone: "yellow", icon: EyeOff, label: t.admin.kb.chips.disabled, note: t.admin.kb.chips.siteOff }
                  : !collection.publicAccess
                    ? { tone: "yellow", icon: EyeOff, label: t.admin.kb.chips.disabled, note: t.admin.kb.chips.notMarked }
                    : collection.hiddenCount > 0
                      ? {
                          tone: "blue",
                          icon: GlobeLock,
                          label: t.admin.kb.chips.partial,
                          note: t.admin.kb.chips.partialHint(collection.hiddenCount),
                        }
                      : { tone: "green", icon: Globe, label: t.admin.kb.chips.enabled, note: t.admin.kb.onPublicSite };

                return (
                  <li
                    key={collection.id}
                    className={
                      "grid grid-cols-1 gap-3 rounded-md border px-4 py-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center" +
                      (collection.archivedAt ? " opacity-70" : "")
                    }
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium break-words">{collection.name}</span>
                        {collection.archivedAt && <Chip tone="gray">{t.admin.kb.chips.archived}</Chip>}
                      </div>
                      {collection.description && (
                        <p className="text-xs text-[var(--muted-foreground)]">{collection.description}</p>
                      )}
                    </div>

                    <p className="text-sm text-[var(--muted-foreground)]">
                      {t.admin.kb.summary(
                        plural(collection.articleCount, t.units.article, t.units.articles, locale),
                        collection.unextractedCount,
                      )}
                    </p>

                    <div>
                      {collection.allCompanies ? (
                        <ChipWithNote
                          tone="green"
                          label={t.admin.kb.chips.allCompanies}
                          note={t.admin.kb.forEveryone}
                        />
                      ) : (
                        <ChipWithNote
                          tone="blue"
                          label={t.admin.kb.chips.someCompanies(names.length)}
                          note={
                            names.length === 0 ? (
                              t.admin.kb.forSome
                            ) : (
                              <ul className="flex flex-col gap-0.5">
                                {names.map((name) => (
                                  <li key={name}>{name}</li>
                                ))}
                              </ul>
                            )
                          }
                        />
                      )}
                    </div>

                    <div>
                      <ChipWithNote
                        tone={visibility.tone}
                        icon={visibility.icon}
                        label={visibility.label}
                        note={visibility.note}
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-3 md:justify-end">
                      <Link href={`/kb/${collection.id}`} className="text-sm underline">
                        {t.admin.kb.view}
                      </Link>
                      <Link
                        href={`/admin/kb/${collection.id}`}
                        className="rounded-md border px-3 py-1.5 text-sm hover:bg-[var(--muted)]"
                      >
                        {t.admin.kb.manage}
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
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
