# CLAUDE.md

Guidance for Claude Code working in this repo. Read docs/ARCHITECTURE.md and docs/API.md first.

## Project
Strata: self-hosted, AGPL-3.0 structured IT documentation (Hudu/IT Glue alternative).
Standalone product. Integrates with any PSA through the REST API, external refs, and webhooks.
No coupling to any specific PSA in core code.

## Non-negotiables
- Users must never need to leave a document to add a field, add a dropdown option, or reorder fields.
- Field values are keyed by field UUID. Never by label.
- Never hard-delete fields, option items, or doc types. Use `archived_at`.
- Every document save writes a revision and an audit log entry.
- All input validated with Zod. Same schemas generate the OpenAPI spec.
- Sanitize richtext HTML server-side.
- Never store, cache, log, export, or webhook a password, TOTP seed, or secure note. Secrets are fetched live from the vault provider on reveal only.
- The bw-serve sidecar never publishes a port.
- Everything runs from `docker compose up`. No required external services beyond Postgres.

## Conventions
- TypeScript strict. Server actions for UI mutations, route handlers under `app/api/v1` for the public API.
- Business logic lives in `src/server/services/*`, shared by server actions and API routes. No logic in route files.
- Drizzle schema in `src/server/db/schema.ts`, mirroring `db/schema.sql`. Migrations via drizzle-kit.
- Tests: Vitest for services, Playwright for the inline-editing flows.
- Commits signed off (`git commit -s`).
- en-US throughout: UI copy, comments, docs, and identifiers. `<html lang="en-US">`; format dates and numbers with an explicit `en-US` locale, never the server default.

## Build phases
Work one phase at a time. Each phase ends with passing tests and a working compose build.

### Phase 0: Skeleton
Next.js app, Dockerfile (multi-stage, standalone output), compose, Drizzle schema + first migration, seed script, Better Auth with local accounts, first-run admin setup screen.

### Phase 1: Hierarchy
Companies and locations CRUD. Company page lists locations and documents grouped by doc type. Sidebar navigation.

### Phase 2: Doc types and documents
Admin page for doc types and template fields. Document view and edit pages. All field types except doc_link and secret_ref. TipTap for markdown/richtext. Revisions on save.

### Phase 3: Inline editing (core differentiator)
Add local field from edit mode. Promote to template. Dropdown "+" to add options. dnd-kit reordering with "this doc / update template" choice. Archive fields.

### Phase 4: Links, search, attachments
doc_link fields with backlinks. Global search (tsvector). Attachments with local/S3 drivers.

### Phase 5: API and integrations
API keys (admin UI), `/api/v1` endpoints, OpenAPI spec, external refs, `/lookup`, `/go/...` deep links, webhooks with retry worker.

### Phase 6: Vault integration
Read docs/VAULT_INTEGRATION.md. VaultProvider interface with `link` and `bw_serve` implementations.
bw-serve sidecar (compose profile `vault`). Company to collection mapping UI. secret_ref item picker scoped to the company's collection.
Reveal password and TOTP with permission check, audit, no-store. Create item from doc when allowed. Graceful fallback to link mode.
Bitwarden Public API add-on (collection per company, event log import) only after the rest works.

### Phase 7: Polish for release
OIDC login, audit log viewer, export (JSON + markdown per company), backup/restore docs, starter doc type pack (ISP, Firewall, Switch, Wi-Fi, Printer, Server, Domain/DNS, M365 tenant, Vendor).

### Later
Per-company permissions, tags, multi-tenant, importers (Hudu, IT Glue CSV).
