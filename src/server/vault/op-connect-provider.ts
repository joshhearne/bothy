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
 * 1Password, through a self-hosted Connect server.
 *
 * Connect is the same shape as the Bitwarden sidecar: it runs on the
 * operator's own network, holds the credentials that reach 1Password, and
 * answers a REST API with a bearer token. Bothy stores a reference to an item
 * and asks for the secret only when somebody clicks reveal.
 *
 * A 1Password item is addressed by vault *and* id, so an item id here is
 * "vaultId/itemId" — the collection mapping stores the vault id, which is what
 * keeps one client's picker out of another client's vault.
 */

const TIMEOUT_MS = 10_000;
/** Details are fetched per item, so a search is capped before it fans out. */
const DETAIL_LIMIT = 25;

type OpField = {
  id?: string;
  type?: string;
  purpose?: string;
  label?: string;
  value?: string;
  totp?: string;
};

type OpItem = {
  id: string;
  title: string;
  category?: string;
  vault?: { id?: string };
  urls?: { primary?: boolean; href?: string }[];
  fields?: OpField[];
};

export function splitItemId(id: string): { vaultId: string; itemId: string } | null {
  const slash = id.indexOf("/");
  if (slash <= 0 || slash === id.length - 1) return null;
  return { vaultId: id.slice(0, slash), itemId: id.slice(slash + 1) };
}

function fieldOf(item: OpItem, purpose: string): OpField | undefined {
  return item.fields?.find((field) => field.purpose === purpose);
}

function otpField(item: OpItem): OpField | undefined {
  return item.fields?.find((field) => field.type === "OTP");
}

export function toSummary(item: OpItem, vaultId: string): VaultItemSummary {
  const username = fieldOf(item, "USERNAME")?.value ?? null;
  const primary = item.urls?.find((url) => url.primary) ?? item.urls?.[0];

  return {
    id: `${vaultId}/${item.id}`,
    name: item.title,
    username,
    uri: primary?.href ?? null,
    collectionIds: [vaultId],
    // A flag only. The seed is read on reveal and never kept.
    hasTotp: Boolean(otpField(item)),
  };
}

export class OpConnectVaultProvider implements VaultProvider {
  readonly kind = "op_connect" as const;
  readonly canBroker = true;

  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly webVaultUrl: string | null,
  ) {}

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...init.headers,
        },
        signal: controller.signal,
        cache: "no-store",
      });

      // 401 means the token is wrong, which for a reader is the same as a
      // vault they cannot reach. Nothing about the body is logged: an item
      // response carries the secret.
      if (response.status === 401 || response.status === 403) {
        throw new VaultUnavailableError("locked");
      }
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
    try {
      // Listing vaults needs the token, so this proves more than a heartbeat.
      await this.call<unknown[]>("/v1/vaults");
      return "ok";
    } catch (err) {
      return err instanceof VaultUnavailableError ? err.status : "unreachable";
    }
  }

  async listItems({
    collectionIds,
    q,
  }: {
    collectionIds: string[];
    q?: string | undefined;
  }): Promise<VaultItemSummary[]> {
    const needle = q?.trim().toLowerCase() ?? "";
    const found: VaultItemSummary[] = [];

    for (const vaultId of collectionIds) {
      const items = await this.call<OpItem[]>(
        `/v1/vaults/${encodeURIComponent(vaultId)}/items`,
      ).catch(() => [] as OpItem[]);

      for (const item of items) {
        if (needle && !item.title?.toLowerCase().includes(needle)) continue;
        found.push(toSummary(item, vaultId));
      }
    }

    /*
     * The list endpoint omits fields, so username and whether there is a TOTP
     * are only known per item. That is one request each, so it is done for the
     * shortlist a person is about to look at and no further.
     */
    const detailed = await Promise.all(
      found.slice(0, DETAIL_LIMIT).map(async (summary) => {
        const full = await this.getItem(summary.id).catch(() => null);
        return full ?? summary;
      }),
    );

    return [...detailed, ...found.slice(DETAIL_LIMIT)];
  }

  async getItem(itemId: string): Promise<VaultItemSummary | null> {
    const parts = splitItemId(itemId);
    if (!parts) return null;

    const item = await this.call<OpItem>(
      `/v1/vaults/${encodeURIComponent(parts.vaultId)}/items/${encodeURIComponent(parts.itemId)}`,
    ).catch(() => null);

    return item ? toSummary(item, parts.vaultId) : null;
  }

  private async fullItem(itemId: string): Promise<OpItem> {
    const parts = splitItemId(itemId);
    if (!parts) throw new VaultUnavailableError("unreachable");

    return this.call<OpItem>(
      `/v1/vaults/${encodeURIComponent(parts.vaultId)}/items/${encodeURIComponent(parts.itemId)}`,
    );
  }

  async revealPassword(itemId: string): Promise<string> {
    const item = await this.fullItem(itemId);
    const password =
      fieldOf(item, "PASSWORD")?.value ??
      item.fields?.find((field) => field.type === "CONCEALED")?.value;

    if (!password) throw new Error("That item has no password");
    return password;
  }

  async revealTotp(itemId: string): Promise<TotpCode> {
    const item = await this.fullItem(itemId);
    const field = otpField(item);

    // Connect returns the computed code on some versions and the seed on
    // others, so take the code when it is offered and work it out when it is not.
    if (field?.totp) return { code: field.totp, period_remaining: 30 };
    if (!field?.value) throw new Error("That item has no one-time password");

    return totpFrom(field.value);
  }

  async createItem(input: {
    collectionId: string;
    name: string;
    username?: string | undefined;
    uri?: string | undefined;
    password: string;
  }): Promise<VaultItemSummary> {
    const body = {
      vault: { id: input.collectionId },
      title: input.name,
      category: "LOGIN",
      fields: [
        ...(input.username
          ? [{ id: "username", type: "STRING", purpose: "USERNAME", value: input.username }]
          : []),
        { id: "password", type: "CONCEALED", purpose: "PASSWORD", value: input.password },
      ],
      ...(input.uri ? { urls: [{ primary: true, href: input.uri }] } : {}),
    };

    const created = await this.call<OpItem>(
      `/v1/vaults/${encodeURIComponent(input.collectionId)}/items`,
      { method: "POST", body: JSON.stringify(body) },
    );

    return toSummary(created, input.collectionId);
  }

  async sync(): Promise<void> {
    // Connect reads through to 1Password on every call; there is nothing local
    // to refresh.
  }

  webVaultItemUrl(itemId: string): string | null {
    const parts = splitItemId(itemId);
    if (!parts) return null;

    // The desktop app's own scheme, which opens the item directly. A web vault
    // URL is used instead when the operator has configured one.
    if (!this.webVaultUrl) {
      return `onepassword://view-item/?v=${encodeURIComponent(parts.vaultId)}&i=${encodeURIComponent(parts.itemId)}`;
    }
    return `${this.webVaultUrl.replace(/\/$/, "")}/open/i?v=${encodeURIComponent(parts.vaultId)}&i=${encodeURIComponent(parts.itemId)}`;
  }
}
