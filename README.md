# Strata (working name)

Self-hosted, open-source structured IT documentation for internal IT teams and MSPs.
A lightweight alternative to Hudu and IT Glue.

- Companies > Locations > Documents hierarchy
- Documents built from templates (doc types) with typed fields
- Add fields and dropdown options inline while editing. No round trips to admin.
- Markdown and rich text fields, drag-and-drop field ordering
- REST API + webhooks for any PSA or ticketing system
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

`db/schema.sql` is the reference data model, `src/server/db/schema.ts` mirrors it,
and the SQL in `drizzle/` is what actually runs. Change all three together:
`npm run db:generate` writes a new migration from the Drizzle schema.
