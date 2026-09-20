import "server-only";
import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { vaultProviders } from "@/server/db/schema";
import { env } from "@/lib/env";
import { writeAudit } from "@/server/services/audit";
import { NotFoundError } from "@/server/services/companies";
import { listRefsForSystem } from "@/server/services/external-refs";
import { LinkVaultProvider } from "@/server/vault/link-provider";
import { BwServeVaultProvider } from "@/server/vault/bw-serve-provider";
import {
  secretRefSchema,
  VAULT_KINDS,
  VaultNotBrokeredError,
  type SecretRef,
  type VaultItemSummary,
  type VaultProvider,
  type VaultStatus,
} from "@/server/vault/types";

/** The system name a company to collection mapping is stored under. */
export const BITWARDEN_SYSTEM = "bitwarden";

export const vaultProviderInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  kind: z.enum(VAULT_KINDS),
  webVaultUrl: z
    .union([z.url({ protocol: /^https?$/ }).max(2_000), z.literal("")])
    .optional()
    .nullable(),
  organizationId: z.string().trim().max(200).optional().nullable(),
  allowCreate: z.boolean().default(false),
  enabled: z.boolean().default(true),
});

export type VaultProviderRow = typeof vaultProviders.$inferSelect;

export async function listVaultProviders(): Promise<VaultProviderRow[]> {
  return db.select().from(vaultProviders).orderBy(asc(vaultProviders.name));
}

export async function getVaultProvider(id: string): Promise<VaultProviderRow | null> {
  const [row] = await db.select().from(vaultProviders).where(eq(vaultProviders.id, id)).limit(1);
  return row ?? null;
}

export async function createVaultProvider(
  input: z.input<typeof vaultProviderInputSchema>,
  actorId: string | null,
): Promise<{ id: string }> {
  const data = vaultProviderInputSchema.parse(input);

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(vaultProviders)
      .values({
        name: data.name,
        kind: data.kind,
        webVaultUrl: data.webVaultUrl || null,
        organizationId: data.organizationId || null,
        allowCreate: data.allowCreate,
        enabled: data.enabled,
      })
      .returning({ id: vaultProviders.id });
    if (!row) throw new Error("Failed to create vault provider");

    await writeAudit(
      {
        userId: actorId,
        action: "vault_provider.created",
        entity: "vault_provider",
        entityId: row.id,
        detail: { name: data.name, kind: data.kind },
      },
      tx,
    );
    return row;
  });
}

export async function updateVaultProvider(
  id: string,
  input: z.input<typeof vaultProviderInputSchema>,
  actorId: string | null,
): Promise<void> {
  const data = vaultProviderInputSchema.parse(input);

  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(vaultProviders)
      .set({
        name: data.name,
        kind: data.kind,
        webVaultUrl: data.webVaultUrl || null,
        organizationId: data.organizationId || null,
        allowCreate: data.allowCreate,
        enabled: data.enabled,
      })
      .where(eq(vaultProviders.id, id))
      .returning({ id: vaultProviders.id });
    if (!row) throw new NotFoundError("Vault provider");

    await writeAudit(
      {
        userId: actorId,
        action: "vault_provider.updated",
        entity: "vault_provider",
        entityId: id,
        detail: { name: data.name, kind: data.kind, enabled: data.enabled },
      },
      tx,
    );
  });
}

function buildProvider(row: VaultProviderRow): VaultProvider {
  if (row.kind === "bw_serve" && env.VAULT_MODE === "bw_serve" && env.BW_SERVE_URL) {
    const accessToken =
      env.BW_SERVE_ACCESS_CLIENT_ID && env.BW_SERVE_ACCESS_CLIENT_SECRET
        ? {
            clientId: env.BW_SERVE_ACCESS_CLIENT_ID,
            clientSecret: env.BW_SERVE_ACCESS_CLIENT_SECRET,
          }
        : undefined;

    return new BwServeVaultProvider(env.BW_SERVE_URL, row.webVaultUrl, accessToken);
  }
  return new LinkVaultProvider(row.webVaultUrl);
}

export type ActiveVault = {
  row: VaultProviderRow;
  provider: VaultProvider;
  status: VaultStatus;
  /** True when the configured provider is brokering rather than only linking. */
  brokering: boolean;
};

/**
 * The enabled provider, already degraded to link mode when the sidecar is down
 * or locked (docs/VAULT_INTEGRATION.md: "secret fields degrade to link mode
 * and show a warning").
 */
export async function getActiveVault(): Promise<ActiveVault | null> {
  const [row] = await db
    .select()
    .from(vaultProviders)
    .where(eq(vaultProviders.enabled, true))
    .orderBy(asc(vaultProviders.name))
    .limit(1);
  if (!row) return null;

  const provider = buildProvider(row);
  if (!provider.canBroker) {
    return { row, provider, status: "ok", brokering: false };
  }

  const status = await provider.status();
  if (status !== "ok") {
    // Record what we saw, then fall back.
    void db
      .update(vaultProviders)
      .set({ status, lastSyncAt: row.lastSyncAt })
      .where(eq(vaultProviders.id, row.id))
      .catch(() => undefined);

    return {
      row,
      provider: new LinkVaultProvider(row.webVaultUrl),
      status,
      brokering: false,
    };
  }

  void db
    .update(vaultProviders)
    .set({ status: "ok", lastSyncAt: new Date() })
    .where(eq(vaultProviders.id, row.id))
    .catch(() => undefined);

  return { row, provider, status: "ok", brokering: true };
}

/** Bitwarden collection ids mapped to a company. */
export async function listCompanyCollections(companyId: string): Promise<string[]> {
  const rows = await listRefsForSystem("company", companyId, BITWARDEN_SYSTEM);
  return rows.map((row) => row.externalId);
}

/**
 * Items a company's documents may reference: the picker only ever searches
 * collections mapped to that company, so one client cannot see another's.
 */
export async function listCompanyVaultItems(
  companyId: string,
  q?: string,
): Promise<{ items: VaultItemSummary[]; vault: ActiveVault | null }> {
  const vault = await getActiveVault();
  if (!vault || !vault.brokering) return { items: [], vault };

  const collectionIds = await listCompanyCollections(companyId);
  if (collectionIds.length === 0) return { items: [], vault };

  const items = await vault.provider.listItems({ collectionIds, q });
  return { items, vault };
}

export function toSecretRef(
  providerId: string,
  item: VaultItemSummary,
  collectionIds: string[],
): SecretRef {
  return secretRefSchema.parse({
    provider_id: providerId,
    item_id: item.id,
    collection_id: item.collectionIds.find((id) => collectionIds.includes(id)) ?? null,
    label: item.name,
    username: item.username,
    uri: item.uri,
  });
}

export class SecretPermissionError extends Error {
  constructor() {
    super("You do not have permission to reveal secrets");
    this.name = "SecretPermissionError";
  }
}

export class SecretScopeError extends Error {
  constructor() {
    super("That item is not in a collection mapped to this company");
    this.name = "SecretScopeError";
  }
}

export type RevealActor = {
  userId: string | null;
  apiKeyId?: string | null;
  canReveal: boolean;
};

/**
 * Checks the item really belongs to a collection mapped to the document's
 * company before anything is fetched. Stops a crafted item id reaching another
 * client's vault.
 */
async function assertItemInScope(companyId: string, itemId: string): Promise<ActiveVault> {
  const vault = await getActiveVault();
  if (!vault) throw new NotFoundError("Vault provider");
  if (!vault.brokering) throw new VaultNotBrokeredError();

  const collectionIds = await listCompanyCollections(companyId);
  if (collectionIds.length === 0) throw new SecretScopeError();

  const item = await vault.provider.getItem(itemId);
  if (!item) throw new NotFoundError("Vault item");
  if (!item.collectionIds.some((id) => collectionIds.includes(id))) throw new SecretScopeError();

  return vault;
}

/** Live fetch, audited, never stored. */
export async function revealPassword(input: {
  companyId: string;
  documentId: string;
  fieldId: string;
  itemId: string;
  actor: RevealActor;
}): Promise<string> {
  if (!input.actor.canReveal) throw new SecretPermissionError();

  const vault = await assertItemInScope(input.companyId, input.itemId);
  const password = await vault.provider.revealPassword(input.itemId);

  // The audit entry records that it happened, never what was revealed.
  await writeAudit({
    userId: input.actor.userId,
    action: "secret.reveal",
    entity: "document",
    entityId: input.documentId,
    detail: {
      fieldId: input.fieldId,
      itemId: input.itemId,
      apiKeyId: input.actor.apiKeyId ?? null,
    },
  });

  return password;
}

export async function revealTotp(input: {
  companyId: string;
  documentId: string;
  fieldId: string;
  itemId: string;
  actor: RevealActor;
}): Promise<{ code: string; period_remaining: number }> {
  if (!input.actor.canReveal) throw new SecretPermissionError();

  const vault = await assertItemInScope(input.companyId, input.itemId);
  const totp = await vault.provider.revealTotp(input.itemId);

  await writeAudit({
    userId: input.actor.userId,
    action: "secret.copy_totp",
    entity: "document",
    entityId: input.documentId,
    detail: {
      fieldId: input.fieldId,
      itemId: input.itemId,
      apiKeyId: input.actor.apiKeyId ?? null,
    },
  });

  return totp;
}

/** Creates an item in the company's collection, when the provider allows it. */
export async function createVaultItem(input: {
  companyId: string;
  collectionId: string;
  name: string;
  username?: string | undefined;
  uri?: string | undefined;
  password: string;
  actorId: string | null;
}): Promise<SecretRef> {
  const vault = await getActiveVault();
  if (!vault) throw new NotFoundError("Vault provider");
  if (!vault.brokering) throw new VaultNotBrokeredError();
  if (!vault.row.allowCreate) throw new VaultNotBrokeredError();

  const collectionIds = await listCompanyCollections(input.companyId);
  if (!collectionIds.includes(input.collectionId)) throw new SecretScopeError();

  const item = await vault.provider.createItem({
    collectionId: input.collectionId,
    name: input.name,
    username: input.username,
    uri: input.uri,
    password: input.password,
  });

  await writeAudit({
    userId: input.actorId,
    action: "secret.created",
    entity: "company",
    entityId: input.companyId,
    // The password is not part of this record, and never will be.
    detail: { itemId: item.id, name: item.name, collectionId: input.collectionId },
  });

  return toSecretRef(vault.row.id, item, collectionIds);
}
