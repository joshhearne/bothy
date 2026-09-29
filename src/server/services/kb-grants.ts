import "server-only";
import { z } from "zod";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db";
import { apiKeyKbCollections, apiKeys, kbCollections } from "@/server/db/schema";
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

export async function setGrant(
  input: z.input<typeof grantInputSchema>,
  actorId: string,
): Promise<void> {
  const data = grantInputSchema.parse(input);

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
        userId: actorId,
        action: "kb_grant.changed",
        entity: "kb_collection",
        entityId: collection.id,
        detail: {
          collection: collection.name,
          apiKeyId: key.id,
          apiKeyName: key.name,
          level: data.level,
        },
      },
      tx,
    );
  });
}
