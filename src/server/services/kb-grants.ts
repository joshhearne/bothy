import "server-only";
import { z } from "zod";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
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

export type KbGrant = {
  collectionId: string;
  /** Reads by name. False when the row only carries another permission. */
  canRead: boolean;
  canWrite: boolean;
  /** May keep favorites and votes for a named reader here. On unless turned off. */
  reactions: boolean;
};

export type KeyGrantRow = {
  apiKeyId: string;
  name: string;
  prefix: string;
  level: GrantLevel;
  reactions: boolean;
  lastUsedAt: Date | null;
};

export const grantInputSchema = z.object({
  apiKeyId: z.uuid(),
  collectionId: z.uuid(),
  level: z.enum(GRANT_LEVELS),
  reactions: z.boolean().optional(),
});

/** Read on every authenticated request, so a change never waits on a cache. */
export async function grantsForKey(apiKeyId: string): Promise<KbGrant[]> {
  return db
    .select({
      collectionId: apiKeyKbCollections.collectionId,
      canRead: apiKeyKbCollections.canRead,
      canWrite: apiKeyKbCollections.canWrite,
      reactions: apiKeyKbCollections.reactions,
    })
    .from(apiKeyKbCollections)
    .innerJoin(kbCollections, eq(kbCollections.id, apiKeyKbCollections.collectionId))
    .where(and(eq(apiKeyKbCollections.apiKeyId, apiKeyId), isNull(kbCollections.archivedAt)));
}

/** What a grant row means as one choice, or its absence. */
function levelOf(row: { canRead: boolean | null; canWrite: boolean | null } | null | undefined): GrantLevel {
  if (!row || !row.canRead) return "none";
  return row.canWrite ? "write" : "read";
}

/** The row to keep for a choice, or null when everything is at its default: no grant by name, reactions on. */
function rowFor(level: GrantLevel, reactions: boolean): { canRead: boolean; canWrite: boolean; reactions: boolean } | null {
  if (level === "none" && reactions) return null;
  return { canRead: level !== "none", canWrite: level === "write", reactions };
}

export type GrantMatrixRow = {
  collectionId: string;
  name: string;
  level: GrantLevel;
  reactions: boolean;
};

/** Every live collection, with what one key may do on each: the matrix for one key. */
export async function grantMatrixForKey(apiKeyId: string): Promise<GrantMatrixRow[]> {
  const rows = await db
    .select({
      collectionId: kbCollections.id,
      name: kbCollections.name,
      canRead: apiKeyKbCollections.canRead,
      canWrite: apiKeyKbCollections.canWrite,
      reactions: apiKeyKbCollections.reactions,
    })
    .from(kbCollections)
    .leftJoin(
      apiKeyKbCollections,
      and(eq(apiKeyKbCollections.collectionId, kbCollections.id), eq(apiKeyKbCollections.apiKeyId, apiKeyId)),
    )
    .where(isNull(kbCollections.archivedAt))
    .orderBy(asc(kbCollections.name));
  return rows.map((row) => ({
    collectionId: row.collectionId,
    name: row.name,
    level: levelOf(row),
    reactions: row.reactions ?? true,
  }));
}

export const grantMatrixInputSchema = z.object({
  apiKeyId: z.uuid(),
  rows: z
    .array(z.object({ collectionId: z.uuid(), level: z.enum(GRANT_LEVELS), reactions: z.boolean().default(true) }))
    .max(500),
});

/**
 * Sets one key's grants on every collection at once, in one transaction with
 * one audit entry that lists what changed. A row left as it was is not
 * written; a row set back to the default with nothing else on is removed.
 */
export async function setGrantMatrix(
  input: z.input<typeof grantMatrixInputSchema>,
  actor: GrantActor,
): Promise<{ changed: number }> {
  const data = grantMatrixInputSchema.parse(input);
  return db.transaction(async (tx) => {
    const [key] = await tx
      .select({ id: apiKeys.id, name: apiKeys.name })
      .from(apiKeys)
      .where(and(eq(apiKeys.id, data.apiKeyId), isNull(apiKeys.revokedAt)))
      .limit(1);
    if (!key) throw new NotFoundError("Active API key");

    const before = new Map((await grantMatrixForKey(key.id)).map((row) => [row.collectionId, row]));
    const changes: { collection: string; level: GrantLevel; reactions: boolean }[] = [];
    for (const row of data.rows) {
      const was = before.get(row.collectionId);
      if (!was) continue; // Not a live collection; nothing to set.
      if (was.level === row.level && was.reactions === row.reactions) continue;
      const wanted = rowFor(row.level, row.reactions);
      if (!wanted) {
        await tx
          .delete(apiKeyKbCollections)
          .where(and(eq(apiKeyKbCollections.apiKeyId, key.id), eq(apiKeyKbCollections.collectionId, row.collectionId)));
      } else {
        await tx
          .insert(apiKeyKbCollections)
          .values({ apiKeyId: key.id, collectionId: row.collectionId, ...wanted })
          .onConflictDoUpdate({
            target: [apiKeyKbCollections.apiKeyId, apiKeyKbCollections.collectionId],
            set: { ...wanted, grantedAt: new Date() },
          });
      }
      changes.push({ collection: was.name, level: row.level, reactions: row.reactions });
    }

    if (changes.length > 0) {
      await writeAudit(
        {
          ...("userId" in actor ? { userId: actor.userId } : {}),
          action: "kb_grant.matrix_changed",
          entity: "api_key",
          entityId: key.id,
          detail: { apiKeyName: key.name, changes, by: actorFields(actor) },
        },
        tx,
      );
    }
    return { changed: changes.length };
  });
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
      canRead: apiKeyKbCollections.canRead,
      canWrite: apiKeyKbCollections.canWrite,
      reactions: apiKeyKbCollections.reactions,
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
    level: row.granted ? levelOf(row) : "none",
    reactions: row.reactions ?? true,
  }));
}

/** Every grant a person holds, read on request so a change takes effect at once. */
export async function grantsForUser(userId: string): Promise<KbGrant[]> {
  return db
    .select({
      collectionId: userKbCollections.collectionId,
      canRead: sql<boolean>`true`,
      canWrite: userKbCollections.canWrite,
      reactions: sql<boolean>`true`,
    })
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

    const [current] = await tx
      .select({ reactions: apiKeyKbCollections.reactions })
      .from(apiKeyKbCollections)
      .where(and(eq(apiKeyKbCollections.apiKeyId, key.id), eq(apiKeyKbCollections.collectionId, collection.id)))
      .limit(1);
    const reactions = data.reactions ?? current?.reactions ?? true;
    const wanted = rowFor(data.level, reactions);
    if (!wanted) {
      await tx
        .delete(apiKeyKbCollections)
        .where(
          and(
            eq(apiKeyKbCollections.apiKeyId, key.id),
            eq(apiKeyKbCollections.collectionId, collection.id),
          ),
        );
    } else {
      await tx
        .insert(apiKeyKbCollections)
        .values({ apiKeyId: key.id, collectionId: collection.id, ...wanted })
        .onConflictDoUpdate({
          target: [apiKeyKbCollections.apiKeyId, apiKeyKbCollections.collectionId],
          set: { ...wanted, grantedAt: new Date() },
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
          reactions,
          by: actorFields(by),
        },
      },
      tx,
    );
  });
}
