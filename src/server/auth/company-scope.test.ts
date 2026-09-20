import { describe, expect, it } from "vitest";
import { ALL_COMPANIES, assertInScope, isInScope, narrowCompanyFilter, only, scopeWhere } from "./company-scope";
import { PgDialect } from "drizzle-orm/pg-core";
import { companies } from "@/server/db/schema";
import { NotFoundError } from "@/server/services/errors";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("isInScope", () => {
  it("lets an unrestricted principal see anything", () => {
    expect(isInScope(ALL_COMPANIES, A)).toBe(true);
  });

  it("admits only what was granted", () => {
    expect(isInScope(only([A]), A)).toBe(true);
    expect(isInScope(only([A]), B)).toBe(false);
  });

  it("gives a principal with no grants nothing", () => {
    expect(isInScope(only([]), A)).toBe(false);
  });
});

describe("assertInScope", () => {
  it("reports a company outside the scope as not found, not as forbidden", () => {
    expect(() => assertInScope(only([A]), B)).toThrow(NotFoundError);
    // The message must not distinguish "does not exist" from "not yours".
    expect(() => assertInScope(only([A]), B)).toThrow("Company not found");
  });

  it("passes what is granted", () => {
    expect(() => assertInScope(only([A]), A)).not.toThrow();
    expect(() => assertInScope(ALL_COMPANIES, B)).not.toThrow();
  });
});

function render(where: ReturnType<typeof scopeWhere>) {
  if (!where) throw new Error("expected a condition");
  return new PgDialect().sqlToQuery(where);
}

describe("scopeWhere", () => {
  it("adds nothing for an unrestricted principal", () => {
    expect(scopeWhere(ALL_COMPANIES, companies.id)).toBeUndefined();
  });

  it("restricts to the granted ids", () => {
    const query = render(scopeWhere(only([A, B]), companies.id));
    expect(query.sql).toContain("in (");
    expect(query.params).toEqual([A, B]);
  });

  it("matches no row when nothing is granted, rather than an empty IN ()", () => {
    expect(render(scopeWhere(only([]), companies.id)).sql).toBe("false");
  });

  it("collapses duplicate grants", () => {
    const scope = only([A, A, B]);
    expect(scope.all).toBe(false);
    expect(render(scopeWhere(scope, companies.id)).params).toEqual([A, B]);
  });
});

describe("narrowCompanyFilter", () => {
  it("keeps a requested company the principal may see", () => {
    expect(narrowCompanyFilter(only([A]), A)?.companyId).toBe(A);
  });

  it("refuses one it may not, so the caller can return an empty page", () => {
    expect(narrowCompanyFilter(only([A]), B)).toBeNull();
  });

  it("passes the scope through when nothing was requested", () => {
    const narrowed = narrowCompanyFilter(only([A]), undefined);
    expect(narrowed?.companyId).toBeUndefined();
    expect(narrowed?.scope).toEqual(only([A]));
  });
});
