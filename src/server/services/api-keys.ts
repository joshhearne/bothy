import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db";
import { apiKeys } from "@/server/db/schema";
import { writeAudit } from "@/server/services/audit";
import { NotFoundError } from "@/server/services/companies";

/**
 * API keys, per docs/ARCHITECTURE.md: 32 random bytes, shown once, stored as a
 * SHA-256 hash, looked up by an indexed prefix.
 */

export const API_SCOPES = ["read", "write", "admin", "secrets:reveal"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

const PREFIX_LENGTH = 8;
const KEY_PREFIX = "bothy_";

export const apiKeyInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  scopes: z
    .array(z.enum(API_SCOPES))
    .min(1, "Choose at least one scope")
    .transform((scopes) => [...new Set(scopes)]),
});

export type ApiKeyInput = z.input<typeof apiKeyInputSchema>;

export type ApiKeyRow = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
};

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** `bothy_<prefix><secret>`: the prefix is stored, the rest never is. */
function generateKey(): { key: string; prefix: string } {
  const body = randomBytes(32).toString("base64url");
  return { key: `${KEY_PREFIX}${body}`, prefix: body.slice(0, PREFIX_LENGTH) };
}

/** Strips the marker from a presented key, if it carries one. */
export function splitKey(presented: string): { marker: string; body: string } {
  return presented.startsWith(KEY_PREFIX)
    ? { marker: KEY_PREFIX, body: presented.slice(KEY_PREFIX.length) }
    : { marker: "", body: presented };
}

export async function listApiKeys(): Promise<ApiKeyRow[]> {
  return db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      scopes: apiKeys.scopes,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .orderBy(asc(apiKeys.createdAt));
}

/** The only time the full key exists. It is never stored or logged. */
export async function createApiKey(
  input: ApiKeyInput,
  actorId: string,
): Promise<{ row: ApiKeyRow; key: string }> {
  const data = apiKeyInputSchema.parse(input);
  const { key, prefix } = generateKey();

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(apiKeys)
      .values({
        name: data.name,
        prefix,
        keyHash: hashKey(key),
        scopes: data.scopes,
        createdBy: actorId,
      })
      .returning({
        id: apiKeys.id,
        name: apiKeys.name,
        prefix: apiKeys.prefix,
        scopes: apiKeys.scopes,
        lastUsedAt: apiKeys.lastUsedAt,
        revokedAt: apiKeys.revokedAt,
        createdAt: apiKeys.createdAt,
      });
    if (!row) throw new Error("Failed to create API key");

    await writeAudit(
      {
        userId: actorId,
        action: "api_key.created",
        entity: "api_key",
        entityId: row.id,
        detail: { name: data.name, scopes: data.scopes, prefix },
      },
      tx,
    );

    return { row, key };
  });
}

export async function revokeApiKey(id: string, actorId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)))
      .returning({ id: apiKeys.id });
    if (!updated) throw new NotFoundError("Active API key");

    await writeAudit(
      { userId: actorId, action: "api_key.revoked", entity: "api_key", entityId: id },
      tx,
    );
  });
}

export type AuthenticatedKey = { id: string; name: string; scopes: ApiScope[] };

/**
 * Resolves a presented key. The prefix narrows to one row, then the full hash
 * is compared in constant time so a wrong key leaks nothing through timing.
 */
export async function authenticateApiKey(presented: string): Promise<AuthenticatedKey | null> {
  const { marker, body } = splitKey(presented);
  if (body.length < PREFIX_LENGTH) return null;

  const [row] = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyHash: apiKeys.keyHash,
      scopes: apiKeys.scopes,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.prefix, body.slice(0, PREFIX_LENGTH)))
    .limit(1);

  if (!row || row.revokedAt) return null;

  const presentedHash = Buffer.from(hashKey(`${marker}${body}`), "hex");
  const storedHash = Buffer.from(row.keyHash, "hex");
  if (presentedHash.length !== storedHash.length) return null;
  if (!timingSafeEqual(presentedHash, storedHash)) return null;

  // Best effort: a failed touch must not fail the request.
  void db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, row.id))
    .catch(() => undefined);

  return {
    id: row.id,
    name: row.name,
    scopes: row.scopes.filter((scope): scope is ApiScope =>
      (API_SCOPES as readonly string[]).includes(scope),
    ),
  };
}

/**
 * admin implies write, write implies read. `secrets:reveal` is never implied:
 * docs/VAULT_INTEGRATION.md requires it to be granted explicitly, off by
 * default.
 */
export function hasScope(granted: ApiScope[], required: ApiScope): boolean {
  if (required === "secrets:reveal") return granted.includes("secrets:reveal");
  if (granted.includes("admin")) return true;
  if (required === "read") return granted.includes("read") || granted.includes("write");
  if (required === "write") return granted.includes("write");
  return false;
}
