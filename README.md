# Strata (working name)

Self-hosted, open-source structured IT documentation for internal IT teams and MSPs.
A lightweight alternative to Hudu and IT Glue.

- Companies > Locations > Documents hierarchy
- Documents built from templates (doc types) with typed fields
- Add fields and dropdown options inline while editing. No round trips to admin.
- Markdown and rich text fields, drag-and-drop field ordering
- Link documents to each other, with backlinks on the target
- Full-text search across every document, no extra service
- Attachments on a local volume or any S3-compatible bucket
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
curl -H "Authorization: Bearer $STRATA_KEY" http://localhost:3080/api/v1/companies
curl -H "Authorization: Bearer $STRATA_KEY" \
  "http://localhost:3080/api/v1/lookup?system=halopsa&entity=company&external_id=123"
```

Webhooks are signed with HMAC-SHA256 in `X-Strata-Signature` (`sha256=<hex>` over
the raw body) and retried with exponential backoff up to 8 attempts by a worker
inside the app container. Set `STRATA_DISABLE_WEBHOOK_WORKER=true` to turn that
worker off, for example on a second replica.

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
APP_PORT=3090 docker compose -p strata-test up -d     # a throwaway stack
npx playwright install chromium                       # first time only
E2E_BASE_URL=http://127.0.0.1:3090 npm run test:e2e
docker compose -p strata-test down -v
```

`db/schema.sql` is the reference data model, `src/server/db/schema.ts` mirrors it,
and the SQL in `drizzle/` is what actually runs. Change all three together:
`npm run db:generate` writes a new migration from the Drizzle schema.
