import "server-only";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db";
import { userCompanies, users } from "@/server/db/schema";
import { writeAudit } from "@/server/services/audit";
import { NotFoundError } from "@/server/services/companies";
import { ROLES, type Role } from "@/server/auth/roles";
import { ALL_COMPANIES, only, type CompanyScope } from "@/server/auth/company-scope";

/**
 * Minimal user administration. Phase 6 needs it because revealing a secret
 * requires `can_reveal_secrets`, and nothing else could grant that.
 */

export type UserRow = {
  id: string;
  email: string;
  name: string;
  role: string;
  canRevealSecrets: boolean;
  allCompanies: boolean;
  companyIds: string[];
  createdAt: Date;
};

export type UserAccess = { allCompanies: boolean; companyIds: string[] };

export async function listUsers(): Promise<UserRow[]> {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      canRevealSecrets: users.canRevealSecrets,
      allCompanies: users.allCompanies,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(asc(users.email));

  const grants = rows.length
    ? await db
        .select({ userId: userCompanies.userId, companyId: userCompanies.companyId })
        .from(userCompanies)
        .where(
          inArray(
            userCompanies.userId,
            rows.map((row) => row.id),
          ),
        )
    : [];

  const byUser = new Map<string, string[]>();
  for (const grant of grants) {
    byUser.set(grant.userId, [...(byUser.get(grant.userId) ?? []), grant.companyId]);
  }

  return rows.map((row) => ({ ...row, companyIds: byUser.get(row.id) ?? [] }));
}

/**
 * What a user may see, read fresh from the database on every request rather
 * than from the session. A grant revoked by an admin has to take effect on the
 * user's next page load, not whenever their session happens to be reissued.
 */
export async function companyScopeForUser(user: {
  id: string;
  role: string;
}): Promise<CompanyScope> {
  // Admins are who grant access; restricting them would lock the instance.
  if (user.role === "admin") return ALL_COMPANIES;

  const [row] = await db
    .select({ allCompanies: users.allCompanies })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  // A user row that has gone away sees nothing.
  if (!row) return only([]);
  if (row.allCompanies) return ALL_COMPANIES;

  const granted = await db
    .select({ companyId: userCompanies.companyId })
    .from(userCompanies)
    .where(eq(userCompanies.userId, user.id));

  return only(granted.map((grant) => grant.companyId));
}

/** Replaces a user's grants wholesale, which is how the admin screen edits them. */
export async function setUserCompanies(
  id: string,
  access: UserAccess,
  actorId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(users)
      .set({ allCompanies: access.allCompanies, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning({ id: users.id });
    if (!row) throw new NotFoundError("User");

    await tx.delete(userCompanies).where(eq(userCompanies.userId, id));

    // Grants are kept even when "all companies" is on, so turning it back off
    // restores the list the admin chose rather than emptying it.
    if (access.companyIds.length > 0) {
      await tx
        .insert(userCompanies)
        .values(access.companyIds.map((companyId) => ({ userId: id, companyId })));
    }

    await writeAudit(
      {
        userId: actorId,
        action: "user.companies_changed",
        entity: "user",
        entityId: id,
        detail: { allCompanies: access.allCompanies, companyIds: access.companyIds },
      },
      tx,
    );
  });
}

export async function setUserRole(id: string, role: Role, actorId: string): Promise<void> {
  if (!(ROLES as readonly string[]).includes(role)) throw new Error("Unknown role");

  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(users)
      .set({ role, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning({ id: users.id });
    if (!row) throw new NotFoundError("User");

    await writeAudit(
      { userId: actorId, action: "user.role_changed", entity: "user", entityId: id, detail: { role } },
      tx,
    );
  });
}

export async function setCanRevealSecrets(
  id: string,
  canReveal: boolean,
  actorId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(users)
      .set({ canRevealSecrets: canReveal, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning({ id: users.id });
    if (!row) throw new NotFoundError("User");

    await writeAudit(
      {
        userId: actorId,
        action: canReveal ? "user.secrets_granted" : "user.secrets_revoked",
        entity: "user",
        entityId: id,
      },
      tx,
    );
  });
}
