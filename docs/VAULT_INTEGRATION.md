# Vault integration: Bitwarden and Vaultwarden

Bothy never stores passwords. Credentials live in the admin's own Bitwarden or Vaultwarden.
Bothy stores references and brokers access.

## Why this approach
- Bitwarden vault data is end-to-end encrypted. No server-side API returns plaintext items.
- The **Bitwarden Public API** only manages org structure (members, groups, collections, events). No item contents. Teams/Enterprise only.
- **Bitwarden Secrets Manager** is a separate product for machine secrets, not a password vault, and Vaultwarden does not implement it.
- The **Vault Management API** (`bw serve`, from the official Bitwarden CLI) runs locally, holds an unlocked vault, and exposes REST endpoints for items, folders, collections, and TOTP. It works against Bitwarden cloud, self-hosted Bitwarden, and Vaultwarden. This is the integration path.

## More than one vault
An MSP inherits whatever each client already uses, so a company may name its
own provider (`companies.vault_provider_id`); a company that names none uses
the instance default. Collection mappings are stored per provider
(`external_refs.system = 'vault:<provider id>'`), so two vaults can both map
the same company without colliding.

## Provider modes
| Mode | Works with | What you get |
|---|---|---|
| `link` | Anything | secret_ref stores a deep link to the item in the web vault. Zero trust required. Default. |
| `bw_serve` | Bitwarden cloud, self-hosted Bitwarden, Vaultwarden | Search/pick items, show username/URI inline, reveal password and TOTP on click, create items from a doc, map companies to collections |
| `bitwarden_public_api` (add-on) | Bitwarden Teams/Enterprise only | Auto-create a collection per company, grant groups, pull vault event logs into the audit view |
| `op_connect` | 1Password Business/Teams | A self-hosted Connect server on your own network, reached with a bearer token. Search, reveal, TOTP, and item creation. An item is addressed `vaultId/itemId`, and a company maps to 1Password vault ids. **Written but not yet verified end to end — see below.** |
| `hashicorp_kv` | HashiCorp Vault, KV v2 | A company maps to a path prefix and each secret under it is an item. `username`/`password`/`totp`/`url` keys are read by convention. Read-only: writing into somebody's KV tree belongs to whoever owns the policies. **Written but not yet verified end to end.** |

### Setting up 1Password Connect
1. In 1Password (Business or Teams), go to **Developer → Infrastructure
   Secrets Management → Other** and set up a Connect server. Choose the vaults
   it may read. You get two things: a `1password-credentials.json` file and an
   access token.
2. Put the file at `./secrets/1password-credentials.json` and `chmod 600` it.
   Put the token in `.env` as `OP_CONNECT_TOKEN`, and set
   `OP_CONNECT_URL=http://op-connect-api:8080` and `VAULT_MODE=op_connect`.
3. Start it: `docker compose --profile onepassword up -d`. Connect runs on the
   internal network and never publishes a port, exactly like bw-serve.
4. In Bothy, **Admin → Vault**, add a provider with mode `op_connect`, then map
   each company to the 1Password **vault id** its secrets live in. A vault id
   is the `id` from `GET /v1/vaults` on Connect, or `op vault list --format
   json` with the CLI.

An item is addressed `vaultId/itemId`, so a secret reference records both, and
a company's picker only ever searches the vaults mapped to that company.

### What is verified, and what is not
The Bitwarden path and the 1Password Connect path are both covered end to end
against stand-in servers (`e2e/vault.spec.ts`, `e2e/op-connect.spec.ts`):
picking an item, storing a reference without the secret, revealing the password
and a one-time code, and degrading to a link when the server stops answering.
The multi-provider refactor is covered by both.

Neither has been run against a live account — the stand-ins answer the
documented API, which proves the client but not the documentation. The TOTP
computation, which Connect needs because it returns a seed rather than a code,
is checked against all four published RFC 6238 vectors.

The HashiCorp KV provider is written against the documented API and compiles,
but has no end-to-end test and has not met a live Vault. Treat it as unproven.

## Architecture (bw_serve)
```
browser -> Bothy app -> (internal docker network only) -> bw-serve sidecar -> Bitwarden/Vaultwarden
```

Running on Cloudflare, the sidecar stays on the operator's own network and the
Worker reaches it through a tunnel that only Cloudflare Access can traverse:
```
browser -> Bothy Worker -> Cloudflare Access (service token) -> tunnel -> bw-serve -> Bitwarden/Vaultwarden
```
Access does the job the private network does above: `bw serve` is never
reachable without the service token. See docs/CLOUDFLARE.md.
- Sidecar runs the official `@bitwarden/cli`, logs in with a dedicated service account (API key), unlocks, and runs `bw serve`.
- `bw serve` has NO authentication. It must never publish a port. Internal network only.
- Bothy calls `/sync` on a schedule (default 5 min) and before item creation.

## Service account
- A dedicated Bitwarden/Vaultwarden user, member of the MSP org.
- Access only to client collections Bothy should see. "Can view" unless item creation is enabled.
- Login via API key (`BW_CLIENTID`/`BW_CLIENTSECRET`). Master password via Docker secret file, not a plain env var.

## Data model
- Company to collection mapping: `external_refs` row with `system = 'bitwarden'`, `entity = 'company'`, `external_id = <collection id>`.
- `secret_ref` field value:
```json
{ "provider_id": "uuid", "item_id": "bw-item-id", "collection_id": "bw-collection-id",
  "label": "Firewall admin", "username": "admin", "uri": "https://10.0.0.1" }
```
  Label/username/uri are cached non-secret metadata for display and search. Refreshed on sync.
  Password, TOTP seed, and notes are NEVER stored or cached. Fetched live on reveal only.

## Rules
- Reveal requires `can_reveal_secrets` permission. Every reveal and copy writes `audit_log` (`secret.reveal`, `secret.copy_totp`).
- Optional re-auth (password or OIDC) before first reveal in a session.
- Revealed values are returned with `Cache-Control: no-store`, never logged, never included in webhooks, revisions, exports, or search.
- API keys need an explicit `secrets:reveal` scope. Off by default.
- The item picker only searches collections mapped to the current company. No cross-client leakage.
- If the sidecar is down or locked, secret fields degrade to `link` mode and show a warning.

## Honest risk statement (put in the docs)
In `bw_serve` mode, anyone who fully compromises the Bothy host can read everything the service account can read.
That is the same tradeoff Hudu and IT Glue make. Scope the service account tightly, keep the sidecar internal,
and use `link` mode if that risk is unacceptable.
