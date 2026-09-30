import "server-only";
import type { Route } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

import { ROLES, type Role } from "@/server/auth/roles";
import { ForbiddenError } from "@/server/services/errors";
import { companyScopeForUser } from "@/server/services/users";
import { hasSecondFactor, mfaDeadlineFor, STEP_UP_MINUTES } from "@/server/services/mfa";
import type { CompanyScope } from "@/server/auth/company-scope";

export { ROLES };
export type { Role };

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  canRevealSecrets: boolean;
  /** An administrator gave them a temporary password; they choose their own next. */
  mustChangePassword: boolean;
  /** This session, for the second step and for ending the others. */
  sessionToken: string;
  mfa: {
    /** Whether they have enrolled anything. */
    enrolled: boolean;
    /** When this session last passed the second step. */
    verifiedAt: Date | null;
  };
};

/** The path a request came from, for sending somebody back after the second step. */
async function cameFrom(fallback: string): Promise<string> {
  const referer = (await headers()).get("referer");
  if (!referer) return fallback;
  try {
    const url = new URL(referer);
    return url.pathname.startsWith("/") ? url.pathname + url.search : fallback;
  } catch {
    return fallback;
  }
}

function toRole(value: unknown): Role {
  return (ROLES as readonly string[]).includes(value as string) ? (value as Role) : "readonly";
}

/** The signed-in user, or null. Says nothing about whether they have finished signing in. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const user = session.user;
  const verifiedAt = (session.session as { mfaVerifiedAt?: Date | string | null }).mfaVerifiedAt;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: toRole(user.role),
    canRevealSecrets: user.canRevealSecrets === true,
    mustChangePassword: (user as { mustChangePassword?: boolean }).mustChangePassword === true,
    sessionToken: session.session.token,
    mfa: {
      enrolled: await hasSecondFactor(user.id),
      verifiedAt: verifiedAt ? new Date(verifiedAt) : null,
    },
  };
}

/** Somebody with a session, finished signing in or not. For the pages that finish it. */
export async function requireSession(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return user;
}

/**
 * Whether this session has passed the second step. Somebody who enrolled
 * nothing has no second step, which is allowed for everyone but an
 * administrator, and administrators are sent to enroll below.
 */
export function mfaSatisfied(user: CurrentUser): boolean {
  return !user.mfa.enrolled || user.mfa.verifiedAt !== null;
}

/**
 * The signed-in user, or a redirect: to sign-in, to the second step, to
 * choosing a password in place of a temporary one, or to enrolling a second
 * factor once an administrator's week is up. Use in pages, layouts, and
 * actions. The pages that finish sign-in (/mfa, /account) use
 * requireSession instead, and are outside the gated layout.
 */
export async function requireUser(): Promise<CurrentUser> {
  const user = await requireSession();

  if (user.mfa.enrolled && user.mfa.verifiedAt === null) {
    redirect(`/mfa?next=${encodeURIComponent(await cameFrom("/"))}` as Route);
  }
  if (user.mustChangePassword) redirect("/account/password?required=1" as Route);
  if (user.role === "admin" && !user.mfa.enrolled) {
    const deadline = await mfaDeadlineFor(user.id);
    if (deadline.getTime() <= Date.now()) redirect("/account/security?required=1" as Route);
  }
  return user;
}

/**
 * The sensitive pages ask for the second step again unless it was passed in
 * the last few minutes: issuing keys, changing people and roles, changing
 * security settings. Somebody with no second factor has nothing to repeat.
 */
export async function requireRecentMfa(user: CurrentUser, path?: string): Promise<void> {
  if (!user.mfa.enrolled) return;
  const verified = user.mfa.verifiedAt?.getTime() ?? 0;
  if (Date.now() - verified > STEP_UP_MINUTES * 60_000) {
    const next = path ?? (await cameFrom("/admin"));
    redirect(`/mfa?next=${encodeURIComponent(next)}&again=1` as Route);
  }
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
