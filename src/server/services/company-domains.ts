import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/server/db";
import { companies, companySignInDomains } from "@/server/db/schema";
import { writeAudit } from "@/server/services/audit";
import { NotFoundError } from "@/server/services/errors";
import { assertInScope, type CompanyScope } from "@/server/auth/company-scope";
import { emailDomain, parseSignInDomains } from "@/server/kb/customer-domains";

/**
 * The email domains that place a visitor with a company. Set on the company,
 * read by the public knowledge base when Cloudflare Access names a visitor.
 */

export class SignInDomainTakenError extends Error {
  constructor(domain: string, company: string) {
    super(`“${domain}” already places people with ${company}`);
    this.name = "SignInDomainTakenError";
  }
}

export async function listSignInDomains(
  companyId: string,
  scope: CompanyScope,
): Promise<string[]> {
  assertInScope(scope, companyId);
  const rows = await db
    .select({ domain: companySignInDomains.domain })
    .from(companySignInDomains)
    .where(eq(companySignInDomains.companyId, companyId))
    .orderBy(asc(companySignInDomains.domain));
  return rows.map((row) => row.domain);
}

/** Replaces the company's list with what was typed. A domain another company holds is refused. */
export async function setSignInDomains(
  companyId: string,
  text: string,
  actorId: string,
  scope: CompanyScope,
): Promise<{ rejected: string[] }> {
  assertInScope(scope, companyId);
  const { domains, rejected } = parseSignInDomains(text);

  await db.transaction(async (tx) => {
    const [company] = await tx
      .select({ id: companies.id })
      .from(companies)
      .where(eq(companies.id, companyId))
      .limit(1);
    if (!company) throw new NotFoundError("Company");

    const before = await tx
      .select({ domain: companySignInDomains.domain })
      .from(companySignInDomains)
      .where(eq(companySignInDomains.companyId, companyId));
    const had = new Set(before.map((row) => row.domain));

    // A domain another company holds is a clash; our own rows are kept.
    const elsewhere = domains.length
      ? await tx
          .select({
            domain: companySignInDomains.domain,
            companyId: companySignInDomains.companyId,
            name: companies.name,
          })
          .from(companySignInDomains)
          .innerJoin(
            companies,
            eq(companies.id, companySignInDomains.companyId),
          )
          .where(inArray(companySignInDomains.domain, domains))
      : [];
    const taken = elsewhere.find((row) => row.companyId !== companyId);
    if (taken) throw new SignInDomainTakenError(taken.domain, taken.name);

    const toRemove = [...had].filter((domain) => !domains.includes(domain));
    const toAdd = domains.filter((domain) => !had.has(domain));
    if (toRemove.length > 0) {
      await tx
        .delete(companySignInDomains)
        .where(
          and(
            eq(companySignInDomains.companyId, companyId),
            inArray(companySignInDomains.domain, toRemove),
          ),
        );
    }
    if (toAdd.length > 0) {
      await tx
        .insert(companySignInDomains)
        .values(toAdd.map((domain) => ({ companyId, domain })));
    }

    if (toRemove.length > 0 || toAdd.length > 0) {
      await writeAudit(
        {
          userId: actorId,
          action: "company.sign_in_domains",
          entity: "company",
          entityId: companyId,
          detail: { added: toAdd, removed: toRemove },
        },
        tx,
      );
    }
  });

  return { rejected };
}

/**
 * The companies a visitor belongs to by their address. No scope: this is
 * how a scope is made for somebody who has none yet. One company per
 * domain, so at most one, but a list is what a scope takes.
 */
export async function companiesForEmail(email: string): Promise<string[]> {
  const domain = emailDomain(email);
  if (!domain) return [];
  const rows = await db
    .select({ companyId: companySignInDomains.companyId })
    .from(companySignInDomains)
    .innerJoin(companies, eq(companies.id, companySignInDomains.companyId))
    .where(
      and(
        eq(companySignInDomains.domain, domain),
        isNull(companies.archivedAt),
      ),
    )
    .limit(5);
  return rows.map((row) => row.companyId);
}
