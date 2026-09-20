import { inArray, sql, type Column, type SQL } from "drizzle-orm";
import { NotFoundError } from "@/server/services/errors";

/**
 * Which companies a principal may see. A principal is a signed-in user or an
 * API key; both are restricted the same way, because the MCP endpoint and the
 * REST API authenticate as keys rather than as people.
 *
 * Out of scope is reported as "not found", never as "forbidden": telling
 * someone a company exists but is not theirs is itself a disclosure.
 */
export type CompanyScope = { all: true } | { all: false; companyIds: readonly string[] };

export const ALL_COMPANIES: CompanyScope = { all: true };

/** A scope limited to a set of companies. An empty set can see nothing. */
export function only(companyIds: readonly string[]): CompanyScope {
  return { all: false, companyIds: [...new Set(companyIds)] };
}

export function isInScope(scope: CompanyScope, companyId: string): boolean {
  return scope.all || scope.companyIds.includes(companyId);
}

export function assertInScope(scope: CompanyScope, companyId: string, what = "Company"): void {
  if (!isInScope(scope, companyId)) throw new NotFoundError(what);
}

/**
 * The SQL a list query adds to its WHERE. Undefined means "add nothing",
 * which is what an unrestricted principal needs; a restricted principal with
 * no grants gets a condition that matches no row, never an empty IN ().
 */
export function scopeWhere(scope: CompanyScope, column: Column): SQL | undefined {
  if (scope.all) return undefined;
  if (scope.companyIds.length === 0) return sql`false`;
  return inArray(column, [...scope.companyIds]);
}

/**
 * Narrows a requested company filter to what the principal may see. Returns
 * null when the request asks for a company outside the scope, which a caller
 * turns into an empty result rather than an error: a filter that matches
 * nothing is not an error, and answering differently would leak existence.
 */
export function narrowCompanyFilter(
  scope: CompanyScope,
  requested: string | undefined,
): { companyId?: string; scope: CompanyScope } | null {
  if (requested === undefined) return { scope };
  if (!isInScope(scope, requested)) return null;
  return { companyId: requested, scope };
}
