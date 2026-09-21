import { z } from "zod";

/**
 * Vault integration. Bothy never stores a password, TOTP seed, or secure note
 * (CLAUDE.md); it stores a reference and brokers access, per
 * docs/VAULT_INTEGRATION.md.
 */

export const VAULT_KINDS = [
  "link",
  "bw_serve",
  "bitwarden_public_api",
  "op_connect",
  "hashicorp_kv",
  "passbolt",
  "keeper",
] as const;
export type VaultKind = (typeof VAULT_KINDS)[number];

/** Non-secret item metadata. Everything here is safe to display and cache. */
export type VaultItemSummary = {
  id: string;
  name: string;
  username: string | null;
  uri: string | null;
  collectionIds: string[];
  hasTotp: boolean;
};

export type VaultStatus = "ok" | "locked" | "unreachable";

export type TotpCode = { code: string; period_remaining: number };

export interface VaultProvider {
  readonly kind: VaultKind;
  /** Whether items can be searched and revealed at all. */
  readonly canBroker: boolean;
  status(): Promise<VaultStatus>;
  listItems(input: { collectionIds: string[]; q?: string | undefined }): Promise<VaultItemSummary[]>;
  getItem(itemId: string): Promise<VaultItemSummary | null>;
  /** Live fetch. The result is never stored, cached, or logged. */
  revealPassword(itemId: string): Promise<string>;
  revealTotp(itemId: string): Promise<TotpCode>;
  createItem(input: {
    collectionId: string;
    name: string;
    username?: string | undefined;
    uri?: string | undefined;
    password: string;
  }): Promise<VaultItemSummary>;
  sync(): Promise<void>;
  /** Deep link into the web vault, used by link mode and as a fallback. */
  webVaultItemUrl(itemId: string): string | null;
}

/**
 * The stored shape of a secret_ref field value: references and non-secret
 * metadata only, exactly as docs/VAULT_INTEGRATION.md specifies.
 */
export const secretRefSchema = z.object({
  provider_id: z.uuid(),
  item_id: z.string().min(1).max(200),
  collection_id: z.string().min(1).max(200).nullable().default(null),
  label: z.string().max(300).default(""),
  username: z.string().max(300).nullable().default(null),
  uri: z.string().max(2_000).nullable().default(null),
});

export type SecretRef = z.infer<typeof secretRefSchema>;

export class VaultUnavailableError extends Error {
  constructor(public readonly status: VaultStatus) {
    super(
      status === "locked"
        ? "The vault sidecar is locked"
        : "The vault sidecar is unreachable",
    );
    this.name = "VaultUnavailableError";
  }
}

export class VaultNotBrokeredError extends Error {
  constructor() {
    super("This vault provider only stores links, so it cannot reveal secrets");
    this.name = "VaultNotBrokeredError";
  }
}
