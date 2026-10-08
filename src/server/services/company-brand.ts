import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { companies, documents, domainChecks } from "@/server/db/schema";
import { writeAudit } from "@/server/services/audit";
import { NotFoundError } from "@/server/services/errors";
import { assertDocumentInScope } from "@/server/services/documents";
import {
  LogoTooLargeError,
  MAX_LOGO_BYTES,
  setCompanyBranding,
  setCompanyLogo,
  sniffImage,
  UnsupportedLogoError,
} from "@/server/services/branding";
import { assertInScope, type CompanyScope } from "@/server/auth/company-scope";
import { fetchPublic, FetchRefusedError } from "@/server/kb/fetch";
import {
  isUsableIcon,
  pickIcon,
  type BrandIcon,
  type BrandSummary,
} from "@/server/domain/brand";
import { looksLikeSvg, svgToPng } from "@/server/domain/svg";
import type { DomainCheckResult } from "@/server/domain/run";

/**
 * A company's look, taken from its own websites. Each domain record that ran
 * the branding check is a candidate; the admin picks one, and its icon and
 * colour become the company's logo and accent. Nothing is applied on its
 * own: a lookup offers, a person chooses.
 */

export type BrandCandidate = {
  documentId: string;
  title: string;
  domain: string;
  brand: BrandSummary;
  /** The icon the page would pick by itself, as an index into brand.icons, or null. */
  suggestedIcon: number | null;
  /** This record's look is the one applied last. */
  applied: boolean;
};

export class BrandApplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrandApplyError";
  }
}

export async function listBrandCandidates(
  companyId: string,
  scope: CompanyScope,
): Promise<BrandCandidate[]> {
  assertInScope(scope, companyId);
  const [company] = await db
    .select({ chosen: companies.brandDomainDocumentId })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  if (!company) throw new NotFoundError("Company");

  const rows = await db
    .select({
      documentId: documents.id,
      title: documents.title,
      result: domainChecks.result,
    })
    .from(domainChecks)
    .innerJoin(documents, eq(documents.id, domainChecks.documentId))
    .where(
      and(
        eq(documents.companyId, companyId),
        isNull(documents.archivedAt),
        sql`${domainChecks.result} -> 'brand' ->> 'ok' = 'true'`,
      ),
    )
    .orderBy(documents.title)
    .limit(50);

  const out: BrandCandidate[] = [];
  for (const row of rows) {
    const result = row.result as DomainCheckResult | null;
    if (!result?.brand?.ok) continue;
    const brand = result.brand.data;
    const suggested = pickIcon(brand.icons);
    out.push({
      documentId: row.documentId,
      title: row.title,
      domain: result.domain,
      brand,
      suggestedIcon: suggested
        ? brand.icons.findIndex((icon) => icon.url === suggested.url)
        : null,
      applied: company.chosen === row.documentId,
    });
  }
  return out;
}

/** One of a record's own icons, by index, or null. Never an address somebody typed. */
export async function brandIconFor(
  documentId: string,
  index: number,
  scope: CompanyScope,
): Promise<BrandIcon | null> {
  await assertDocumentInScope(documentId, scope);
  const [row] = await db
    .select({ result: domainChecks.result })
    .from(domainChecks)
    .where(eq(domainChecks.documentId, documentId))
    .limit(1);
  const result = row?.result as DomainCheckResult | null;
  if (!result?.brand?.ok) return null;
  return result.brand.data.icons[index] ?? null;
}

/**
 * Fetches one of a record's icons the safe way, and says what it is from its
 * bytes. A logo may be PNG, JPEG or WebP; an SVG is rendered to PNG with its
 * transparency; an ICO is refused, as it is at upload.
 */
export async function fetchBrandIcon(
  icon: BrandIcon,
): Promise<{ bytes: Buffer; mime: string; extension: string }> {
  let page;
  try {
    page = await fetchPublic(
      icon.url,
      "image/png,image/jpeg,image/webp,image/*;q=0.8,*/*;q=0.1",
    );
  } catch (error) {
    throw new BrandApplyError(
      error instanceof FetchRefusedError
        ? error.message
        : "The icon could not be fetched.",
    );
  }
  if (page.status < 200 || page.status >= 300) {
    throw new BrandApplyError(`The site answered ${page.status} for the icon.`);
  }
  if (page.body.byteLength === 0 || page.body.byteLength > MAX_LOGO_BYTES) {
    throw new LogoTooLargeError();
  }
  const kind = sniffImage(page.body);
  if (kind) return { bytes: page.body, ...kind };

  // An SVG is rendered to PNG, transparency kept: the look without the document.
  if (looksLikeSvg(page.body)) {
    const png = await svgToPng(page.body);
    if (png.byteLength > MAX_LOGO_BYTES) throw new LogoTooLargeError();
    return { bytes: png, mime: "image/png", extension: "png" };
  }
  throw new UnsupportedLogoError();
}

/**
 * Makes a record's website look the company's: its icon the logo, its colour
 * the accent, and the record remembered as the one chosen, so a company with
 * several websites can say which one it is. Either part may be left out.
 */
export async function applyDomainBranding(
  companyId: string,
  input: { documentId: string; icon: number | null; color: string | null },
  actorId: string,
  scope: CompanyScope,
): Promise<void> {
  assertInScope(scope, companyId);
  const candidates = await listBrandCandidates(companyId, scope);
  const candidate = candidates.find((c) => c.documentId === input.documentId);
  if (!candidate)
    throw new BrandApplyError("That record has no website branding to apply.");

  const icon =
    input.icon === null ? null : (candidate.brand.icons[input.icon] ?? null);
  if (input.icon !== null && !icon)
    throw new BrandApplyError("That icon is not one the site offered.");
  if (icon && !isUsableIcon(icon)) throw new UnsupportedLogoError();
  const color = input.color;
  if (color !== null && !candidate.brand.colors.includes(color)) {
    throw new BrandApplyError("That colour is not one the site published.");
  }
  if (!icon && !color)
    throw new BrandApplyError("Choose an icon, a colour, or both.");

  if (icon) {
    const fetched = await fetchBrandIcon(icon);
    const file = new File(
      [new Uint8Array(fetched.bytes)],
      `logo.${fetched.extension}`,
      {
        type: fetched.mime,
      },
    );
    await setCompanyLogo(companyId, file, actorId, scope, "primary");
  }

  if (color) {
    const [current] = await db
      .select({ scheme: companies.brandScheme, altAccent: companies.altAccent })
      .from(companies)
      .where(eq(companies.id, companyId))
      .limit(1);
    await setCompanyBranding(
      companyId,
      {
        scheme: current?.scheme,
        accent: color,
        altAccent: current?.altAccent ?? null,
      },
      actorId,
      scope,
    );
  }

  await db.transaction(async (tx) => {
    await tx
      .update(companies)
      .set({ brandDomainDocumentId: candidate.documentId })
      .where(eq(companies.id, companyId));
    await writeAudit(
      {
        userId: actorId,
        action: "branding.applied_from_domain",
        entity: "company",
        entityId: companyId,
        detail: {
          documentId: candidate.documentId,
          domain: candidate.domain,
          icon: icon?.url ?? null,
          color,
        },
      },
      tx,
    );
  });
}
