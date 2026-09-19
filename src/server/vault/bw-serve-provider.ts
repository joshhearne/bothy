import "server-only";
import {
  VaultUnavailableError,
  type TotpCode,
  type VaultItemSummary,
  type VaultProvider,
  type VaultStatus,
} from "@/server/vault/types";

/**
 * Talks to the `bw serve` sidecar over the internal docker network.
 *
 * `bw serve` has no authentication, which is why the sidecar never publishes a
 * port (docs/VAULT_INTEGRATION.md). Nothing here logs a response body: a reveal
 * response contains the secret itself.
 */

type BwEnvelope<T> = { success: boolean; data?: T; message?: string };

type BwItem = {
  id: string;
  name: string;
  collectionIds?: string[] | null;
  login?: {
    username?: string | null;
    totp?: string | null;
    uris?: { uri?: string | null }[] | null;
  } | null;
};

const TIMEOUT_MS = 10_000;

export function toSummary(item: BwItem): VaultItemSummary {
  return {
    id: item.id,
    name: item.name,
    username: item.login?.username ?? null,
    uri: item.login?.uris?.[0]?.uri ?? null,
    collectionIds: item.collectionIds ?? [],
    // Only ever a flag. The seed itself is never read or stored.
    hasTotp: Boolean(item.login?.totp),
  };
}

export class BwServeVaultProvider implements VaultProvider {
  readonly kind = "bw_serve" as const;
  readonly canBroker = true;

  constructor(
    private readonly baseUrl: string,
    private readonly webVaultUrl: string | null,
  ) {}

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
        ...init,
        headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
    } catch {
      throw new VaultUnavailableError("unreachable");
    }

    if (response.status === 401 || response.status === 403) {
      throw new VaultUnavailableError("locked");
    }

    let body: BwEnvelope<T>;
    try {
      body = (await response.json()) as BwEnvelope<T>;
    } catch {
      throw new VaultUnavailableError("unreachable");
    }

    if (!response.ok || !body.success) {
      // The message may name the item but never contains its secret.
      const message = body.message ?? `bw serve returned ${response.status}`;
      if (/locked/i.test(message)) throw new VaultUnavailableError("locked");
      throw new Error(`Vault request failed: ${message}`);
    }

    return body.data as T;
  }

  async status(): Promise<VaultStatus> {
    try {
      const data = await this.call<{ template?: { status?: string }; status?: string }>("/status");
      const status = data.template?.status ?? data.status;
      return status === "unlocked" ? "ok" : "locked";
    } catch (err) {
      if (err instanceof VaultUnavailableError) return err.status;
      return "unreachable";
    }
  }

  async listItems(input: { collectionIds: string[]; q?: string | undefined }): Promise<VaultItemSummary[]> {
    if (input.collectionIds.length === 0) return [];

    const results: VaultItemSummary[] = [];
    for (const collectionId of input.collectionIds) {
      const search = new URLSearchParams({ collectionid: collectionId });
      if (input.q) search.set("search", input.q);

      const data = await this.call<{ data?: BwItem[] } | BwItem[]>(
        `/list/object/items?${search.toString()}`,
      );
      const items = Array.isArray(data) ? data : (data.data ?? []);
      for (const item of items) results.push(toSummary(item));
    }

    // One item can live in several mapped collections.
    const seen = new Set<string>();
    return results.filter((item) => (seen.has(item.id) ? false : seen.add(item.id)));
  }

  async getItem(itemId: string): Promise<VaultItemSummary | null> {
    try {
      const item = await this.call<BwItem>(`/object/item/${encodeURIComponent(itemId)}`);
      return toSummary(item);
    } catch (err) {
      if (err instanceof VaultUnavailableError) throw err;
      return null;
    }
  }

  async revealPassword(itemId: string): Promise<string> {
    const data = await this.call<string | { data?: string }>(
      `/object/password/${encodeURIComponent(itemId)}`,
    );
    const password = typeof data === "string" ? data : (data.data ?? "");
    if (password === "") throw new Error("That item has no password");
    return password;
  }

  async revealTotp(itemId: string): Promise<TotpCode> {
    const data = await this.call<string | { data?: string }>(
      `/object/totp/${encodeURIComponent(itemId)}`,
    );
    const code = typeof data === "string" ? data : (data.data ?? "");
    if (code === "") throw new Error("That item has no TOTP");

    // bw serve returns the current code; TOTP steps are 30 seconds wide.
    const period = 30;
    return { code, period_remaining: period - (Math.floor(Date.now() / 1000) % period) };
  }

  async createItem(input: {
    collectionId: string;
    name: string;
    username?: string | undefined;
    uri?: string | undefined;
    password: string;
  }): Promise<VaultItemSummary> {
    await this.sync();

    const item = await this.call<BwItem>("/object/item", {
      method: "POST",
      body: JSON.stringify({
        type: 1,
        name: input.name,
        collectionIds: [input.collectionId],
        login: {
          username: input.username ?? null,
          password: input.password,
          uris: input.uri ? [{ uri: input.uri, match: null }] : [],
        },
      }),
    });

    return toSummary(item);
  }

  async sync(): Promise<void> {
    await this.call("/sync", { method: "POST" });
  }

  webVaultItemUrl(itemId: string): string | null {
    if (!this.webVaultUrl) return null;
    const base = this.webVaultUrl.replace(/\/$/, "");
    return `${base}/#/vault?itemId=${encodeURIComponent(itemId)}`;
  }
}
