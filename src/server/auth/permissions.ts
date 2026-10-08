/**
 * What a role may do, as a set of named permissions. The three roles the
 * product started with are here with exactly the powers docs/ARCHITECTURE.md
 * gives them, and they cannot be changed; a role an administrator makes is
 * any subset. Pure, so the session helpers and the page can share it.
 */

export const PERMISSIONS = [
  /** Companies and locations: create, edit, archive, their branding and timings. */
  "hierarchy.manage",
  /** Documents: create, edit, archive, attachments, local fields, promoting, racks, schedules, domain checks. */
  "documents.edit",
  /** Doc types, template fields, and the shared option lists themselves. */
  "doc_types.manage",
  /** Works with secret fields: the coloring preference is offered. */
  "secrets.fields",
  /** Writes knowledge base articles in any collection without a grant. */
  "kb.write",
  /**
   * The administration area and everything in it: people, roles, keys,
   * webhooks, settings, branding, the knowledge base's administration, the
   * portal, the vault, the audit log. A role with this is an administrator in
   * every sense: it sees every company, must keep a second factor, and is who
   * grants access.
   */
  "admin.area",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const BUILTIN_ROLE_KEYS = ["admin", "tech", "readonly"] as const;

export type BuiltinRoleKey = (typeof BUILTIN_ROLE_KEYS)[number];

/** The built-in roles' powers, which are the product's word and not the operator's. */
export const BUILTIN_PERMISSIONS: Record<
  BuiltinRoleKey,
  readonly Permission[]
> = {
  admin: [...PERMISSIONS],
  tech: ["documents.edit", "secrets.fields"],
  readonly: [],
};

export function isPermission(value: unknown): value is Permission {
  return (
    typeof value === "string" &&
    (PERMISSIONS as readonly string[]).includes(value)
  );
}

export function isBuiltinRole(key: string): key is BuiltinRoleKey {
  return (BUILTIN_ROLE_KEYS as readonly string[]).includes(key);
}

/** A role's key: lower case, letters, digits and hyphens, from what somebody typed. */
export function toRoleKey(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function isAdministrator(permissions: ReadonlySet<Permission>): boolean {
  return permissions.has("admin.area");
}
