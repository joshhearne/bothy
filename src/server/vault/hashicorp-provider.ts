import "server-only";
import {
  VaultUnavailableError,
  type TotpCode,
  type VaultItemSummary,
  type VaultProvider,
  type VaultStatus,
} from "@/server/vault/types";
import { totpFrom } from "@/server/vault/totp";

/**
 * HashiCorp Vault, against a KV version 2 mount.
 *
 * KV has no notion of an item with named fields, so a convention is needed: a
 * secret is a path, and the keys in it are read as username, password, totp
 * and url. A "collection" is a path prefix, which is what a company is mapped
 * to — mapping a company to `clients/acme` keeps its picker inside that
 * subtree, and Vault's own policies should say the same thing.
 */

const TIMEOUT_MS = 10_000;
const LIST_LIMIT = 200;

/** The keys a login is read from, in the order they are looked for. */
const USERNAME_KEYS = ["username", "user", "login", "account"];
const PASSWORD_KEYS = ["password", "pass", "secret", "value"];
const TOTP_KEYS = ["totp", "otp", "otpauth", "mfa"];
const URL_KEYS = ["url", "uri", "address", "host"];

type KvRead = { data?: { data?: Record<string, unknown>; metadata?: unknown } };
type KvList = { data?: { keys?: string[] } };

function pick(data: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const found = Object.entries(data).find(([name]) => name.toLowerCase() === key);
    if (found && typeof found[1] === "string" && found[1] !== "") return found[1];
  }
  return null;
}

export function summaryFrom(
  path: string,
  prefix: string,
  data: Record<string, unknown>,
): VaultItemSummary {
  return {
    id: path,
    // The leaf is the name a person recognises; the prefix is the client.
    name: path.slice(prefix.length).replace(/^\//, "") || path,
    username: pick(data, USERNAME_KEYS),
    uri: pick(data, URL_KEYS),
    collectionIds: [prefix],
    hasTotp: pick(data, TOTP_KEYS) !== null,
  };
}

export class HashicorpVaultProvider implements VaultProvider {
  readonly kind = "hashicorp_kv" as const;
  readonly canBroker = true;

  constructor(
    private readonly addr: string,
    private readonly token: string,
    private readonly mount: string,
    private readonly webVaultUrl: string | null,
  ) {}

  private async call<T>(path: string, method = "GET"): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(`${this.addr.replace(/\/$/, "")}${path}`, {
        method,
        headers: { "X-Vault-Token": this.token, Accept: "application/json" },
        signal: controller.signal,
        cache: "no-store",
      });

      if (response.status === 403) throw new VaultUnavailableError("locked");
      if (response.status === 404) throw new VaultUnavailableError("unreachable");
      if (!response.ok) throw new VaultUnavailableError("unreachable");

      return (await response.json()) as T;
    } catch (err) {
      if (err instanceof VaultUnavailableError) throw err;
      throw new VaultUnavailableError("unreachable");
    } finally {
      clearTimeout(timer);
    }
  }

  async status(): Promise<VaultStatus> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      // Health says whether it is sealed, which is Vault's word for locked.
      const response = await fetch(`${this.addr.replace(/\/$/, "")}/v1/sys/health`, {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok && response.status !== 429) {
        // 503 is a sealed Vault; anything else is not answering properly.
        return response.status === 503 ? "locked" : "unreachable";
      }

      // And the token has to work, or nothing can be read.
      await this.call("/v1/auth/token/lookup-self");
      return "ok";
    } catch (err) {
      return err instanceof VaultUnavailableError ? err.status : "unreachable";
    } finally {
      clearTimeout(timer);
    }
  }

  /** Every secret under a prefix, walking the tree Vault reports. */
  private async pathsUnder(prefix: string): Promise<string[]> {
    const clean = prefix.replace(/^\/|\/$/g, "");
    const found: string[] = [];
    const queue = [clean];

    while (queue.length > 0 && found.length < LIST_LIMIT) {
      const current = queue.shift() as string;
      const listed = await this.call<KvList>(
        `/v1/${encodeURI(this.mount)}/metadata/${encodeURI(current)}?list=true`,
      ).catch(() => null);

      for (const key of listed?.data?.keys ?? []) {
        // Vault marks a folder with a trailing slash.
        if (key.endsWith("/")) queue.push(`${current}/${key.slice(0, -1)}`);
        else found.push(`${current}/${key}`);
      }
    }
    return found;
  }

  private async read(path: string): Promise<Record<string, unknown>> {
    const clean = path.replace(/^\//, "");
    const body = await this.call<KvRead>(`/v1/${encodeURI(this.mount)}/data/${encodeURI(clean)}`);
    return body.data?.data ?? {};
  }

  async listItems({
    collectionIds,
    q,
  }: {
    collectionIds: string[];
    q?: string | undefined;
  }): Promise<VaultItemSummary[]> {
    const needle = q?.trim().toLowerCase() ?? "";
    const items: VaultItemSummary[] = [];

    for (const prefix of collectionIds) {
      const paths = await this.pathsUnder(prefix);

      for (const path of paths) {
        if (needle && !path.toLowerCase().includes(needle)) continue;
        const data = await this.read(path).catch(() => null);
        if (data) items.push(summaryFrom(path, prefix.replace(/^\/|\/$/g, ""), data));
      }
    }
    return items;
  }

  async getItem(itemId: string): Promise<VaultItemSummary | null> {
    const data = await this.read(itemId).catch(() => null);
    if (!data) return null;

    const prefix = itemId.slice(0, itemId.lastIndexOf("/"));
    return summaryFrom(itemId, prefix, data);
  }

  async revealPassword(itemId: string): Promise<string> {
    const password = pick(await this.read(itemId), PASSWORD_KEYS);
    if (!password) throw new Error("That secret has no password key");
    return password;
  }

  async revealTotp(itemId: string): Promise<TotpCode> {
    const seed = pick(await this.read(itemId), TOTP_KEYS);
    if (!seed) throw new Error("That secret has no TOTP key");
    return totpFrom(seed);
  }

  async createItem(): Promise<VaultItemSummary> {
    // Writing into somebody's KV tree is a decision for whoever owns the
    // policies, not for a documentation tool.
    throw new Error("This vault is read-only from Bothy");
  }

  async sync(): Promise<void> {
    // Read through on every call; there is nothing cached to refresh.
  }

  webVaultItemUrl(itemId: string): string | null {
    const base = this.webVaultUrl ?? this.addr;
    if (!base) return null;
    return `${base.replace(/\/$/, "")}/ui/vault/secrets/${encodeURIComponent(this.mount)}/show/${encodeURI(itemId.replace(/^\//, ""))}`;
  }
}
