import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { writeAudit } from "@/server/services/audit";
import { NotFoundError } from "@/server/services/companies";
import { ROLES, type Role } from "@/server/auth/session";

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
  createdAt: Date;
};

export async function listUsers(): Promise<UserRow[]> {
  return db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      canRevealSecrets: users.canRevealSecrets,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(asc(users.email));
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
