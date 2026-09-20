import "server-only";
import {
  VaultNotBrokeredError,
  type TotpCode,
  type VaultItemSummary,
  type VaultProvider,
  type VaultStatus,
} from "@/server/vault/types";

/**
 * The default mode: Bothy holds a deep link and nothing else. Also what
 * bw_serve degrades to when the sidecar is down or locked.
 */
export class LinkVaultProvider implements VaultProvider {
  readonly kind = "link" as const;
  readonly canBroker = false;

  constructor(private readonly webVaultUrl: string | null) {}

  async status(): Promise<VaultStatus> {
    return "ok";
  }

  async listItems(): Promise<VaultItemSummary[]> {
    return [];
  }

  async getItem(): Promise<VaultItemSummary | null> {
    return null;
  }

  async revealPassword(): Promise<string> {
    throw new VaultNotBrokeredError();
  }

  async revealTotp(): Promise<TotpCode> {
    throw new VaultNotBrokeredError();
  }

  async createItem(): Promise<VaultItemSummary> {
    throw new VaultNotBrokeredError();
  }

  async sync(): Promise<void> {
    // Nothing to sync.
  }

  webVaultItemUrl(itemId: string): string | null {
    if (!this.webVaultUrl) return null;
    const base = this.webVaultUrl.replace(/\/$/, "");
    return `${base}/#/vault?itemId=${encodeURIComponent(itemId)}`;
  }
}
