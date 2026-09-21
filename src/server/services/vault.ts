import "server-only";
import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { companies, vaultProviders } from "@/server/db/schema";
import { env } from "@/lib/env";
import { writeAudit } from "@/server/services/audit";
import { NotFoundError } from "@/server/services/companies";
import { listRefsForSystem } from "@/server/services/external-refs";
import { assertInScope, type CompanyScope } from "@/server/auth/company-scope";
import { LinkVaultProvider } from "@/server/vault/link-provider";
import { BwServeVaultProvider } from "@/server/vault/bw-serve-provider";
import { OpConnectVaultProvider } from "@/server/vault/op-connect-provider";
import { HashicorpVaultProvider } from "@/server/vault/hashicorp-provider";
import {
  secretRefSchema,
  VAULT_KINDS,
  VaultNotBrokeredError,
  type SecretRef,
  type VaultItemSummary,
  type VaultProvider,
  type VaultStatus,
} from "@/server/vault/types";

/**
 * Collection mappings are stored per provider, so two vaults can both map the
 * same company without colliding.
 */
export function mappingSystem(providerId: string): string {
  return `vault:${providerId}`;
}

/** The system name mappings used before there could be more than one vault. */
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

/**
 * A provider row says which vault this is; the environment holds what is
 * needed to reach it. A provider whose credentials are missing falls back to
 * link mode rather than failing, which is the same answer a sidecar that is
 * down gives.
 */
function buildProvider(row: VaultProviderRow): VaultProvider {
  switch (row.kind) {
    case "bw_serve": {
      if (env.VAULT_MODE !== "bw_serve" || !env.BW_SERVE_URL) break;

      const accessToken =
        env.BW_SERVE_ACCESS_CLIENT_ID && env.BW_SERVE_ACCESS_CLIENT_SECRET
          ? {
              clientId: env.BW_SERVE_ACCESS_CLIENT_ID,
              clientSecret: env.BW_SERVE_ACCESS_CLIENT_SECRET,
            }
          : undefined;

      return new BwServeVaultProvider(env.BW_SERVE_URL, row.webVaultUrl, accessToken);
    }

    case "op_connect": {
      if (!env.OP_CONNECT_URL || !env.OP_CONNECT_TOKEN) break;
      return new OpConnectVaultProvider(env.OP_CONNECT_URL, env.OP_CONNECT_TOKEN, row.webVaultUrl);
    }

    case "hashicorp_kv": {
      if (!env.HASHICORP_VAULT_ADDR || !env.HASHICORP_VAULT_TOKEN) break;
      return new HashicorpVaultProvider(
        env.HASHICORP_VAULT_ADDR,
        env.HASHICORP_VAULT_TOKEN,
        env.HASHICORP_VAULT_MOUNT,
        row.webVaultUrl,
      );
    }

    default:
      break;
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
export async function getActiveVault(providerId?: string | null): Promise<ActiveVault | null> {
  const [row] = providerId
    ? await db.select().from(vaultProviders).where(eq(vaultProviders.id, providerId)).limit(1)
    : await db
        .select()
        .from(vaultProviders)
        .where(eq(vaultProviders.enabled, true))
        .orderBy(asc(vaultProviders.name))
        .limit(1);
  if (!row || !row.enabled) return null;

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

/**
 * Which vault holds this client's secrets: the one the company names, or the
 * instance default when it names none.
 */
export async function getVaultForCompany(companyId: string): Promise<ActiveVault | null> {
  const [row] = await db
    .select({ providerId: companies.vaultProviderId })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);

  const chosen = row?.providerId ? await getActiveVault(row.providerId) : null;
  // A company pointing at a provider that has been turned off falls back
  // rather than losing its secrets entirely.
  return chosen ?? (await getActiveVault());
}

/** Points one client at the vault its secrets actually live in. */
export async function setCompanyVaultProvider(
  companyId: string,
  providerId: string | null,
  actorId: string,
  scope: CompanyScope,
): Promise<void> {
  assertInScope(scope, companyId);

  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(companies)
      .set({ vaultProviderId: providerId })
      .where(eq(companies.id, companyId))
      .returning({ id: companies.id });
    if (!row) throw new NotFoundError("Company");

    await writeAudit(
      {
        userId: actorId,
        action: "vault_provider.assigned",
        entity: "company",
        entityId: companyId,
        detail: { providerId },
      },
      tx,
    );
  });
}

/** Collection or vault ids mapped to a company, within one provider. */
export async function listCompanyCollections(
  companyId: string,
  providerId: string,
): Promise<string[]> {
  const rows = await listRefsForSystem("company", companyId, mappingSystem(providerId));
  return rows.map((row) => row.externalId);
}

/**
 * Items a company's documents may reference: the picker only ever searches
 * collections mapped to that company, so one client cannot see another's.
 */
export async function listCompanyVaultItems(
  companyId: string,
  scope: CompanyScope,
  q?: string,
): Promise<{ items: VaultItemSummary[]; vault: ActiveVault | null }> {
  assertInScope(scope, companyId);
  const vault = await getVaultForCompany(companyId);
  if (!vault || !vault.brokering) return { items: [], vault };

  const collectionIds = await listCompanyCollections(companyId, vault.row.id);
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
  const vault = await getVaultForCompany(companyId);
  if (!vault) throw new NotFoundError("Vault provider");
  if (!vault.brokering) throw new VaultNotBrokeredError();

  const collectionIds = await listCompanyCollections(companyId, vault.row.id);
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
  scope: CompanyScope;
}): Promise<SecretRef> {
  assertInScope(input.scope, input.companyId);
  const vault = await getVaultForCompany(input.companyId);
  if (!vault) throw new NotFoundError("Vault provider");
  if (!vault.brokering) throw new VaultNotBrokeredError();
  if (!vault.row.allowCreate) throw new VaultNotBrokeredError();

  const collectionIds = await listCompanyCollections(input.companyId, vault.row.id);
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
