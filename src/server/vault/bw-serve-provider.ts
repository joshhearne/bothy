import "server-only";
import {
  VaultUnavailableError,
  type TotpCode,
  type VaultItemSummary,
  type VaultProvider,
  type VaultStatus,
} from "@/server/vault/types";

/**
 * Talks to the `bw serve` sidecar.
 *
 * `bw serve` has no authentication of its own. In the Docker deployment it is
 * reachable only on the internal network and never publishes a port. In a
 * Cloudflare deployment the sidecar stays on the operator's own network and is
 * reached through a Cloudflare Tunnel fronted by Access, with a service token
 * on every request — so an unauthenticated caller is stopped at the edge and
 * never reaches the vault.
 *
 * Nothing here logs a response body: a reveal response contains the secret.
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
    /** Cloudflare Access service token, when the sidecar is behind a tunnel. */
    private readonly accessToken?: { clientId: string; clientSecret: string } | undefined,
  ) {}

  private authHeaders(): Record<string, string> {
    if (!this.accessToken) return {};
    return {
      "CF-Access-Client-Id": this.accessToken.clientId,
      "CF-Access-Client-Secret": this.accessToken.clientSecret,
    };
  }

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...this.authHeaders(),
          ...(init?.headers ?? {}),
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
    } catch {
      throw new VaultUnavailableError("unreachable");
    }

    if (response.status === 401 || response.status === 403) {
      // Either the vault is locked, or Access refused the service token. Both
      // mean the same thing here: we cannot broker, so degrade to link mode.
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
