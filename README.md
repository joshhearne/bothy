# Bothy

Self-hosted, open-source structured IT documentation for internal IT teams and MSPs.
A lightweight alternative to Hudu and IT Glue.

> A bothy is a simple shelter in the hills, left unlocked and kept stocked by
> whoever passes through, for whoever comes next. That is what good client
> documentation is: not a record you keep for yourself, but something you
> maintain for the person who picks up the ticket after you.

- Companies > Locations > Documents hierarchy
- Documents built from templates (doc types) with typed fields
- Add fields and dropdown options inline while editing. No round trips to admin.
- Markdown and rich text fields, drag-and-drop field ordering
- Link documents to each other, with backlinks on the target
- Full-text search across every document, no extra service
- Attachments on a local volume or any S3-compatible bucket
- Credentials stay in your own Bitwarden or Vaultwarden; Bothy brokers access
- Local accounts or OIDC single sign-on, with an append-only audit trail
- en-US and en-GB interface, switchable per reader
- Per-company export as JSON or Markdown
- REST API + signed webhooks for any PSA or ticketing system
- Deep links and an id mapping so a ticket can jump straight to its client
- One `docker compose up` to run

License: AGPL-3.0. Contributions require DCO sign-off (see CONTRIBUTING.md).

## Quick start
```bash
cp .env.example .env
# set POSTGRES_PASSWORD, match it in DATABASE_URL, and:
#   openssl rand -base64 32   -> AUTH_SECRET
docker compose up -d
```
App: http://localhost:3080 — the first visit opens a one-time setup screen that
creates the administrator account. Migrations run automatically on container start.

Set `SEED_ON_START=true` to load the starter doc types (see `scripts/seed.ts`).
Change the published port with `APP_PORT` in `.env`, and keep `APP_URL` in step —
Better Auth rejects requests whose origin does not match it.

## API

`/api/v1`, authenticated with an API key as a bearer token (Admin → API keys).
The spec is generated from the same Zod schemas the endpoints validate with and
served at `/api/v1/openapi.json`.

```bash
curl -H "Authorization: Bearer $BOTHY_KEY" http://localhost:3080/api/v1/companies
curl -H "Authorization: Bearer $BOTHY_KEY" \
  "http://localhost:3080/api/v1/lookup?system=halopsa&entity=company&external_id=123"
```

Webhooks are signed with HMAC-SHA256 in `X-Bothy-Signature` (`sha256=<hex>` over
the raw body) and retried with exponential backoff up to 8 attempts by a worker
inside the app container. Set `BOTHY_DISABLE_WEBHOOK_WORKER=true` to turn that
worker off, for example on a second replica.

## Secrets

Bothy never stores a password, TOTP seed, or secure note. A `secret_ref` field
holds a reference plus non-secret metadata; the value itself is fetched live
from your own Bitwarden or Vaultwarden when someone with `can_reveal_secrets`
asks for it, and every reveal is audited.

- `VAULT_MODE=link` (default) stores a deep link into the web vault. No trust
  required, nothing to run.
- `VAULT_MODE=bw_serve` brokers search, reveal, TOTP, and item creation through
  a sidecar running the official Bitwarden CLI:
  `docker compose --profile vault up -d`. The sidecar has no authentication of
  its own, so it never publishes a port and stays on the internal network.

If the sidecar is locked or unreachable, secret fields degrade to link mode and
say so.

**Worth being plain about:** in `bw_serve` mode, anyone who fully compromises
the Bothy host can read everything the service account can read. That is the
same tradeoff Hudu and IT Glue make. Scope the service account to the
collections Bothy should see, keep the sidecar internal, and stay on `link`
mode if that risk is unacceptable. See `docs/VAULT_INTEGRATION.md`.

## Backups

`docs/BACKUP.md` covers what to keep, how to restore it, and how to verify a
dump before you need it. In short: `pg_dump` the database, archive the uploads
volume, and store `.env` with them.

## Language

The interface ships in en-US, with en-GB available as a translation. Readers
pick their own in the header; `APP_LOCALE` sets what a new visitor gets, and
`SEED_LOCALE` sets the wording of the seeded starter content (so a British
install gets "Fibre" rather than "Fiber"). Dates and numbers follow the same
choice.

Adding a language means one file: copy `src/i18n/en-GB.ts`, override only the
strings that differ from `src/i18n/en-US.ts`, and add the code to
`src/i18n/locales.ts`. Anything left out falls back to en-US, so a partial
translation is still usable.

## Single sign-on

Set `OIDC_ISSUER`, `OIDC_CLIENT_ID`, and `OIDC_CLIENT_SECRET` (all three or
none) and the sign-in page offers SSO alongside local accounts. `APP_URL` must
be the origin people actually browse to: the redirect URI and the cookie that
carries the OAuth state are both built from it, so a mismatch fails the
callback with `state_mismatch`. Discovery is
used, so Entra ID, Google, Authentik, and Keycloak all work. Accounts created
this way start with the `tech` role and cannot reveal secrets until an
administrator says so under Admin → Users.

## Development
```bash
npm install
npm run dev          # http://0.0.0.0:3080
npm run db:migrate   # apply migrations against DATABASE_URL
npm run db:seed
npm test             # Vitest service tests
npm run lint
npm run typecheck
```

End-to-end tests drive the inline editing flows in a real browser against a
running instance:

```bash
APP_PORT=3090 docker compose -p bothy-test up -d     # a throwaway stack
npx playwright install chromium                       # first time only
E2E_BASE_URL=http://127.0.0.1:3090 npm run test:e2e
docker compose -p bothy-test down -v
```

The tests read the database directly. If your `.env` sets a database role
other than the default, pass it along with `E2E_DB_USER`.

`db/schema.sql` is the reference data model, `src/server/db/schema.ts` mirrors it,
and the SQL in `drizzle/` is what actually runs. Change all three together:
`npm run db:generate` writes a new migration from the Drizzle schema.
