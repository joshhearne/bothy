import "server-only";
import { z } from "zod";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db";
import { apiKeyKbCollections, apiKeys, kbCollections, userKbCollections, users } from "@/server/db/schema";
import { writeAudit } from "@/server/services/audit";
import { NotFoundError } from "@/server/services/errors";

/**
 * What an API key may do with a knowledge base collection. The same keys the
 * rest of the API uses: a key is connected to a collection once, here, and
 * from then on whatever holds the key keeps the collection current without
 * anybody being asked again. Changing or withdrawing the grant applies to the
 * key's next request.
 */

export const GRANT_LEVELS = ["none", "read", "write"] as const;
export type GrantLevel = (typeof GRANT_LEVELS)[number];

export type KbGrant = { collectionId: string; canWrite: boolean };

export type KeyGrantRow = {
  apiKeyId: string;
  name: string;
  prefix: string;
  level: GrantLevel;
  lastUsedAt: Date | null;
};

export const grantInputSchema = z.object({
  apiKeyId: z.uuid(),
  collectionId: z.uuid(),
  level: z.enum(GRANT_LEVELS),
});

/** Read on every authenticated request, so a change never waits on a cache. */
export async function grantsForKey(apiKeyId: string): Promise<KbGrant[]> {
  return db
    .select({
      collectionId: apiKeyKbCollections.collectionId,
      canWrite: apiKeyKbCollections.canWrite,
    })
    .from(apiKeyKbCollections)
    .innerJoin(kbCollections, eq(kbCollections.id, apiKeyKbCollections.collectionId))
    .where(and(eq(apiKeyKbCollections.apiKeyId, apiKeyId), isNull(kbCollections.archivedAt)));
}

/** Every key that is still in use, and what it may do with this collection. */
export async function listKeyGrants(collectionId: string): Promise<KeyGrantRow[]> {
  const rows = await db
    .select({
      apiKeyId: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      lastUsedAt: apiKeys.lastUsedAt,
      granted: apiKeyKbCollections.collectionId,
      canWrite: apiKeyKbCollections.canWrite,
    })
    .from(apiKeys)
    .leftJoin(
      apiKeyKbCollections,
      and(
        eq(apiKeyKbCollections.apiKeyId, apiKeys.id),
        eq(apiKeyKbCollections.collectionId, collectionId),
      ),
    )
    .where(isNull(apiKeys.revokedAt))
    .orderBy(asc(apiKeys.name), asc(apiKeys.createdAt));

  return rows.map((row) => ({
    apiKeyId: row.apiKeyId,
    name: row.name,
    prefix: row.prefix,
    lastUsedAt: row.lastUsedAt,
    level: !row.granted ? "none" : row.canWrite ? "write" : "read",
  }));
}

/** Every grant a person holds, read on request so a change takes effect at once. */
export async function grantsForUser(userId: string): Promise<KbGrant[]> {
  return db
    .select({ collectionId: userKbCollections.collectionId, canWrite: userKbCollections.canWrite })
    .from(userKbCollections)
    .innerJoin(kbCollections, eq(kbCollections.id, userKbCollections.collectionId))
    .where(and(eq(userKbCollections.userId, userId), isNull(kbCollections.archivedAt)));
}

export type UserGrantRow = {
  userId: string;
  name: string;
  email: string;
  role: string;
  level: GrantLevel;
};

/** Every person, and what they may do with this collection by name. Administrators need no grant. */
export async function listUserGrants(collectionId: string): Promise<UserGrantRow[]> {
  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      granted: userKbCollections.collectionId,
      canWrite: userKbCollections.canWrite,
    })
    .from(users)
    .leftJoin(
      userKbCollections,
      and(eq(userKbCollections.userId, users.id), eq(userKbCollections.collectionId, collectionId)),
    )
    .orderBy(asc(users.name), asc(users.email));
  return rows.map((row) => ({
    userId: row.userId,
    name: row.name,
    email: row.email,
    role: row.role,
    level: !row.granted ? "none" : row.canWrite ? "write" : "read",
  }));
}

export const userGrantInputSchema = z.object({
  userId: z.uuid(),
  collectionId: z.uuid(),
  level: z.enum(GRANT_LEVELS),
});

/** Who made a grant change: a person at the keyboard, or a key with the admin scope. */
export type GrantActor = { userId: string } | { apiKeyId: string; apiKeyName: string };

function actorFields(actor: GrantActor) {
  return "userId" in actor ? { userId: actor.userId } : { apiKeyId: actor.apiKeyId, apiKeyName: actor.apiKeyName };
}

export async function setUserGrant(
  input: z.input<typeof userGrantInputSchema>,
  actor: GrantActor,
): Promise<void> {
  const data = userGrantInputSchema.parse(input);

  await db.transaction(async (tx) => {
    const [person] = await tx
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.id, data.userId))
      .limit(1);
    if (!person) throw new NotFoundError("User");

    const [collection] = await tx
      .select({ id: kbCollections.id, name: kbCollections.name })
      .from(kbCollections)
      .where(eq(kbCollections.id, data.collectionId))
      .limit(1);
    if (!collection) throw new NotFoundError("Collection");

    if (data.level === "none") {
      await tx
        .delete(userKbCollections)
        .where(and(eq(userKbCollections.userId, person.id), eq(userKbCollections.collectionId, collection.id)));
    } else {
      const canWrite = data.level === "write";
      await tx
        .insert(userKbCollections)
        .values({ userId: person.id, collectionId: collection.id, canWrite })
        .onConflictDoUpdate({
          target: [userKbCollections.userId, userKbCollections.collectionId],
          set: { canWrite, grantedAt: new Date() },
        });
    }

    await writeAudit(
      {
        ...("userId" in actor ? { userId: actor.userId } : {}),
        action: "kb_grant.changed",
        entity: "kb_collection",
        entityId: collection.id,
        detail: {
          collection: collection.name,
          grantee: { userId: person.id, email: person.email },
          level: data.level,
          by: actorFields(actor),
        },
      },
      tx,
    );
  });
}

export async function setGrant(
  input: z.input<typeof grantInputSchema>,
  actor: string | GrantActor,
): Promise<void> {
  const data = grantInputSchema.parse(input);
  const by: GrantActor = typeof actor === "string" ? { userId: actor } : actor;

  await db.transaction(async (tx) => {
    const [key] = await tx
      .select({ id: apiKeys.id, name: apiKeys.name })
      .from(apiKeys)
      .where(and(eq(apiKeys.id, data.apiKeyId), isNull(apiKeys.revokedAt)))
      .limit(1);
    if (!key) throw new NotFoundError("Active API key");

    const [collection] = await tx
      .select({ id: kbCollections.id, name: kbCollections.name })
      .from(kbCollections)
      .where(eq(kbCollections.id, data.collectionId))
      .limit(1);
    if (!collection) throw new NotFoundError("Collection");

    if (data.level === "none") {
      await tx
        .delete(apiKeyKbCollections)
        .where(
          and(
            eq(apiKeyKbCollections.apiKeyId, key.id),
            eq(apiKeyKbCollections.collectionId, collection.id),
          ),
        );
    } else {
      const canWrite = data.level === "write";
      await tx
        .insert(apiKeyKbCollections)
        .values({ apiKeyId: key.id, collectionId: collection.id, canWrite })
        .onConflictDoUpdate({
          target: [apiKeyKbCollections.apiKeyId, apiKeyKbCollections.collectionId],
          set: { canWrite, grantedAt: new Date() },
        });
    }

    await writeAudit(
      {
        ...("userId" in by ? { userId: by.userId } : {}),
        action: "kb_grant.changed",
        entity: "kb_collection",
        entityId: collection.id,
        detail: {
          collection: collection.name,
          apiKeyId: key.id,
          apiKeyName: key.name,
          level: data.level,
          by: actorFields(by),
        },
      },
      tx,
    );
  });
}
