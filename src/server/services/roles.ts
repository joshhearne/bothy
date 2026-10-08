import "server-only";
import { z } from "zod";
import { and, asc, count, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db";
import { roles, users } from "@/server/db/schema";
import { writeAudit } from "@/server/services/audit";
import { NotFoundError } from "@/server/services/errors";
import { forgetRoles } from "@/server/auth/roles";
import {
  BUILTIN_PERMISSIONS,
  isBuiltinRole,
  PERMISSIONS,
  toRoleKey,
  type Permission,
} from "@/server/auth/permissions";

/**
 * Roles an administrator can see and make. The three built-in ones are
 * shown with the powers the product gives them and cannot be changed or
 * archived; a custom role carries any subset, and goes only when nobody
 * holds it.
 */

export type RoleRow = {
  key: string;
  name: string;
  description: string | null;
  permissions: Permission[];
  builtin: boolean;
  /** People holding the role, archived or not. */
  holders: number;
};

export class RoleInUseError extends Error {
  constructor(holders: number) {
    super(
      `${holders} ${holders === 1 ? "person holds" : "people hold"} this role; give them another first`,
    );
    this.name = "RoleInUseError";
  }
}

export class RoleTakenError extends Error {
  constructor(key: string) {
    super(`A role with the key “${key}” already exists`);
    this.name = "RoleTakenError";
  }
}

export class BuiltinRoleError extends Error {
  constructor() {
    super("A built-in role cannot be changed");
    this.name = "BuiltinRoleError";
  }
}

export const roleInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
  key: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((value) => (value ? toRoleKey(value) : "")),
  description: z.string().trim().max(500).optional().nullable(),
  permissions: z.array(z.enum(PERMISSIONS)).default([]),
});

export type RoleInput = z.input<typeof roleInputSchema>;

export async function listRoles(): Promise<RoleRow[]> {
  const rows = await db
    .select({
      key: roles.key,
      name: roles.name,
      description: roles.description,
      permissions: roles.permissions,
      builtin: roles.builtin,
      holders: count(users.id),
    })
    .from(roles)
    .leftJoin(users, eq(users.role, roles.key))
    .where(isNull(roles.archivedAt))
    .groupBy(roles.key)
    .orderBy(asc(roles.builtin), asc(roles.name));

  // Built-ins first, in the product's order, then the operator's by name.
  const order = (key: string) =>
    isBuiltinRole(key) ? ["admin", "tech", "readonly"].indexOf(key) : 99;
  return rows
    .map((row) => ({
      key: row.key,
      name: row.name,
      description: row.description,
      permissions: isBuiltinRole(row.key)
        ? [...BUILTIN_PERMISSIONS[row.key]]
        : (row.permissions ?? []).filter((p): p is Permission =>
            (PERMISSIONS as readonly string[]).includes(p),
          ),
      builtin: row.builtin,
      holders: Number(row.holders),
    }))
    .sort(
      (a, b) =>
        order(a.key) - order(b.key) ||
        (a.builtin === b.builtin ? a.name.localeCompare(b.name) : 0),
    );
}

/** Whether a role may be given to somebody: it exists and is not archived. */
export async function roleExists(key: string): Promise<boolean> {
  const [row] = await db
    .select({ key: roles.key })
    .from(roles)
    .where(and(eq(roles.key, key), isNull(roles.archivedAt)))
    .limit(1);
  return Boolean(row);
}

export async function createRole(
  input: RoleInput,
  actorId: string,
): Promise<string> {
  const data = roleInputSchema.parse(input);
  const key = data.key || toRoleKey(data.name);
  if (!key) throw new RoleTakenError(key);
  if (isBuiltinRole(key)) throw new RoleTakenError(key);

  await db.transaction(async (tx) => {
    const [taken] = await tx
      .select({ key: roles.key })
      .from(roles)
      .where(eq(roles.key, key))
      .limit(1);
    if (taken) throw new RoleTakenError(key);
    await tx.insert(roles).values({
      key,
      name: data.name,
      description: data.description || null,
      permissions: data.permissions,
      builtin: false,
    });
    await writeAudit(
      {
        userId: actorId,
        action: "role.created",
        entity: "role",
        entityId: null,
        detail: { key, name: data.name, permissions: data.permissions },
      },
      tx,
    );
  });
  forgetRoles();
  return key;
}

export async function updateRole(
  key: string,
  input: Omit<RoleInput, "key">,
  actorId: string,
): Promise<void> {
  if (isBuiltinRole(key)) throw new BuiltinRoleError();
  const data = roleInputSchema.parse({ ...input, key });

  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(roles)
      .set({
        name: data.name,
        description: data.description || null,
        permissions: data.permissions,
      })
      .where(and(eq(roles.key, key), isNull(roles.archivedAt)))
      .returning({ key: roles.key });
    if (!row) throw new NotFoundError("Role");
    await writeAudit(
      {
        userId: actorId,
        action: "role.updated",
        entity: "role",
        entityId: null,
        detail: { key, name: data.name, permissions: data.permissions },
      },
      tx,
    );
  });
  forgetRoles();
}

/** Archive, never delete; and only when nobody holds it, since a person must have a role. */
export async function archiveRole(key: string, actorId: string): Promise<void> {
  if (isBuiltinRole(key)) throw new BuiltinRoleError();

  await db.transaction(async (tx) => {
    const [held] = await tx
      .select({ holders: count() })
      .from(users)
      .where(eq(users.role, key));
    const holders = Number(held?.holders ?? 0);
    if (holders > 0) throw new RoleInUseError(holders);
    const [row] = await tx
      .update(roles)
      .set({ archivedAt: new Date() })
      .where(and(eq(roles.key, key), isNull(roles.archivedAt)))
      .returning({ key: roles.key });
    if (!row) throw new NotFoundError("Role");
    await writeAudit(
      {
        userId: actorId,
        action: "role.archived",
        entity: "role",
        entityId: null,
        detail: { key },
      },
      tx,
    );
  });
  forgetRoles();
}
