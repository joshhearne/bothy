import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

import { ROLES, type Role } from "@/server/auth/roles";
import { ForbiddenError } from "@/server/services/errors";
import { companyScopeForUser } from "@/server/services/users";
import type { CompanyScope } from "@/server/auth/company-scope";

export { ROLES };
export type { Role };

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  canRevealSecrets: boolean;
};

function toRole(value: unknown): Role {
  return (ROLES as readonly string[]).includes(value as string) ? (value as Role) : "readonly";
}

/** The signed-in user, or null. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const user = session.user;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: toRole(user.role),
    canRevealSecrets: user.canRevealSecrets === true,
  };
}

/** The signed-in user, or a redirect to sign-in. Use in pages and layouts. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return user;
}

/**
 * Which companies this user may see. Admins are never restricted; everyone
 * else gets what `user_companies` grants them, read fresh from the database so
 * a revoked grant applies on the next request rather than the next sign-in.
 */
export async function getCompanyScope(user: CurrentUser): Promise<CompanyScope> {
  return companyScopeForUser(user);
}

/** The pair every company-aware page needs: who is asking, and what they may see. */
export async function requireScopedUser(): Promise<{ user: CurrentUser; scope: CompanyScope }> {
  const user = await requireUser();
  return { user, scope: await getCompanyScope(user) };
}

/** Thrown by services when the caller's role is not enough. */
export { ForbiddenError } from "@/server/services/errors";

/*
 * Permissions v1, straight from docs/ARCHITECTURE.md:
 *   admin    everything, including deleting doc types and managing API keys/webhooks
 *   tech     create/edit docs, add local fields, promote fields, add dropdown options
 *   readonly view only
 * Anything the spec does not grant tech is admin-only.
 */

/** Companies and locations: not among tech's granted powers, so admin-only. */
export function canManageHierarchy(role: Role): boolean {
  return role === "admin";
}

/** Doc types, template fields, and option lists themselves. */
export function canManageDocTypes(role: Role): boolean {
  return role === "admin";
}

/** Create and edit documents, add local fields, promote fields. */
export function canEditDocuments(role: Role): boolean {
  return role === "admin" || role === "tech";
}

/** The inline "+" on a dropdown, which appends to a shared option list. */
export function canAddOptionItems(role: Role): boolean {
  return role === "admin" || role === "tech";
}

export function canManageIntegrations(role: Role): boolean {
  return role === "admin";
}

async function require(check: (role: Role) => boolean): Promise<CurrentUser> {
  const user = await requireUser();
  if (!check(user.role)) throw new ForbiddenError();
  return user;
}

export const requireHierarchyManager = () => require(canManageHierarchy);
export const requireDocTypeManager = () => require(canManageDocTypes);
export const requireDocumentEditor = () => require(canEditDocuments);
export const requireAdmin = () => require((role) => role === "admin");
