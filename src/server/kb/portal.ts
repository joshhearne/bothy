import "server-only";
import { asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/server/db";
import {
  companies,
  kbCollectionCompanies,
  kbCollections,
} from "@/server/db/schema";
import {
  getKbPublicSettings,
  type KbPublicSettings,
} from "@/server/services/settings";
import { getInstanceBranding, type Branding } from "@/server/services/branding";
import {
  listAllSignInDomains,
  type CompanySignInDomains,
} from "@/server/services/company-domains";
import { accessLastVerifiedAt } from "@/server/kb/identity";
import { fetchPublic, FetchRefusedError } from "@/server/kb/fetch";

/**
 * Everything the setup page for the public knowledge base needs, read in one
 * go: what is set, what answers, and what is on the site. The hostname is
 * tried from here, the safe way, so the page can say whether the published
 * address reaches this installation rather than leaving the operator to guess.
 */

export type HostnameCheck =
  | { state: "unset" }
  | { state: "answers"; status: number }
  | { state: "refused"; reason: string }
  | { state: "unreachable" };

export type PortalCollection = {
  id: string;
  name: string;
  publicAccess: boolean;
  allCompanies: boolean;
  /** The companies it is kept to, by name, when it is not for everyone. */
  keptTo: string[];
};

export type PortalStatus = {
  settings: KbPublicSettings;
  hostname: HostnameCheck;
  accessConfigured: boolean;
  accessLastVerifiedAt: Date | null;
  collections: PortalCollection[];
  companies: CompanySignInDomains[];
  branding: Branding;
};

async function checkHostname(url: string | null): Promise<HostnameCheck> {
  if (!url) return { state: "unset" };
  try {
    const page = await fetchPublic(new URL("/pub/kb", url).toString());
    return { state: "answers", status: page.status };
  } catch (error) {
    if (error instanceof FetchRefusedError)
      return { state: "refused", reason: error.message };
    return { state: "unreachable" };
  }
}

export async function portalStatus(): Promise<PortalStatus> {
  const settings = await getKbPublicSettings();
  const [hostname, branding, companiesWithDomains, rows, kept] =
    await Promise.all([
      checkHostname(settings.url),
      getInstanceBranding(),
      listAllSignInDomains(),
      db
        .select({
          id: kbCollections.id,
          name: kbCollections.name,
          publicAccess: kbCollections.publicAccess,
          allCompanies: kbCollections.allCompanies,
        })
        .from(kbCollections)
        .where(isNull(kbCollections.archivedAt))
        .orderBy(asc(kbCollections.name)),
      db
        .select({
          collectionId: kbCollectionCompanies.collectionId,
          names: sql<
            string[]
          >`array_agg(${companies.name} order by ${companies.name})`,
        })
        .from(kbCollectionCompanies)
        .innerJoin(companies, eq(companies.id, kbCollectionCompanies.companyId))
        .groupBy(kbCollectionCompanies.collectionId),
    ]);
  const keptTo = new Map(kept.map((row) => [row.collectionId, row.names]));

  return {
    settings,
    hostname,
    accessConfigured: Boolean(settings.accessTeam && settings.accessAud),
    accessLastVerifiedAt: accessLastVerifiedAt(),
    collections: rows.map((row) => ({
      ...row,
      keptTo: row.allCompanies ? [] : (keptTo.get(row.id) ?? []),
    })),
    companies: companiesWithDomains,
    branding,
  };
}
