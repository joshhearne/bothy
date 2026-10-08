import "server-only";
import { isNull } from "drizzle-orm";
import { db } from "@/server/db";
import { roles } from "@/server/db/schema";
import {
  BUILTIN_PERMISSIONS,
  BUILTIN_ROLE_KEYS,
  isAdministrator as holdsAdminArea,
  isBuiltinRole,
  isPermission,
  type Permission,
} from "@/server/auth/permissions";

/**
 * The roles as the request sees them. Roles live in the database, but the
 * permission checks are everywhere and synchronous, so they read a copy held
 * in this process: loaded once a request has a user, refreshed every so
 * often, and dropped the moment a role is changed here. A built-in role is
 * answered from the product's own table even before the first load.
 */

/** Kept for the places that still name the three the product started with. */
export const ROLES = BUILTIN_ROLE_KEYS;
export type Role = string;

const TTL_MS = 30_000;
let cache: {
  at: number;
  permissions: Map<string, ReadonlySet<Permission>>;
} | null = null;

export async function loadRoles(force = false): Promise<void> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return;
  const rows = await db
    .select({ key: roles.key, permissions: roles.permissions })
    .from(roles)
    .where(isNull(roles.archivedAt));
  const permissions = new Map<string, ReadonlySet<Permission>>();
  for (const row of rows) {
    const set = new Set<Permission>();
    for (const value of row.permissions ?? [])
      if (isPermission(value)) set.add(value);
    // The built-in roles' powers are the product's word, whatever the row says.
    permissions.set(
      row.key,
      isBuiltinRole(row.key) ? new Set(BUILTIN_PERMISSIONS[row.key]) : set,
    );
  }
  cache = { at: Date.now(), permissions };
}

/** Called after a role changes, so the next check sees it. */
export function forgetRoles(): void {
  cache = null;
}

const NONE: ReadonlySet<Permission> = new Set();

/** What a role may do. An unknown or archived role may do nothing, like readonly. */
export function permissionsOf(role: string): ReadonlySet<Permission> {
  const known = cache?.permissions.get(role);
  if (known) return known;
  if (isBuiltinRole(role)) return new Set(BUILTIN_PERMISSIONS[role]);
  return NONE;
}

export function can(role: string, permission: Permission): boolean {
  return permissionsOf(role).has(permission);
}

/** An administrator in every sense: the role holds the admin area. */
export function isAdministrator(role: string): boolean {
  return holdsAdminArea(permissionsOf(role));
}
