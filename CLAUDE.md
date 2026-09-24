# CLAUDE.md

Guidance for Claude Code working in this repo. Read docs/ARCHITECTURE.md and docs/API.md first.

## Project
Bothy: self-hosted, AGPL-3.0 structured IT documentation (Hudu/IT Glue alternative).
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
- Every read of company-owned data takes a `CompanyScope`. Out of scope is "not found", never "forbidden".
- An uploaded file's type comes from its own bytes, never from what the browser claimed.
- A lookup aimed at a user-supplied name resolves first, refuses non-public addresses, and connects to the address it checked.
- Everything runs from `docker compose up`. No required external services beyond Postgres.

## Conventions
- TypeScript strict. Server actions for UI mutations, route handlers under `app/api/v1` for the public API.
- Business logic lives in `src/server/services/*`, shared by server actions and API routes. No logic in route files.
- Drizzle schema in `src/server/db/schema.ts`, mirroring `db/schema.sql`. Migrations via drizzle-kit.
- Tests: Vitest for services, Playwright for the inline-editing flows.
- Commits signed off (`git commit -s`).
- en-US is the source language: code, comments, docs, identifiers, and the base catalog in `src/i18n/en-US.ts`. Never hardcode interface copy in a component — add a key and read it through `getMessages()` (server) or `useMessages()` (client).
- Other locales are overrides on the base catalog (`src/i18n/en-GB.ts`), so a translation only states what differs and can never miss a key.
- Format dates and numbers with the reader's locale through `src/i18n/format.ts`, never the server default and never a hardcoded `en-US`.

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

### Phase 8: Per-company access
Grants per user and per API key (`user_companies`, `api_key_companies`), default-deny for new rows,
admins unrestricted. Enforced in the service layer, not in pages. See docs/ARCHITECTURE.md.

### Phase 9: Branding
Instance name/logo/accent and the same per company. Accent is validated hex, re-derived per surface
for contrast; logos are raster only, sniffed by magic bytes. See docs/ARCHITECTURE.md.

### Phase 10: Attachment policy
Accepted types decided by magic bytes; HEIC/HEIF converted to JPEG; macro-enabled and legacy
Office refused. See docs/ARCHITECTURE.md.

### Phase 11: Domain checks
DNS, TLS, RDAP and email posture per domain record, run on request and stored. Field roles
(`fields.domain_role`) decide which field holds the domain. See docs/ARCHITECTURE.md.

### Phase 12: Rack elevations
Rack doc types (`doc_types.is_rack`) with `racks` / `rack_mounts` / `rack_type_colors`. Colour is
per equipment kind: MSP default, client override, built-in palette. Closeness is judged in Oklab.
See docs/ARCHITECTURE.md.

### Phase 13: Schedules
Per-document expiry and recurring maintenance, a lead time, `document.due` webhooks announced once
per date, and Admin → Notifications listing what is due. See docs/ARCHITECTURE.md.

### Later
Tags, multi-tenant, importers (Hudu, IT Glue CSV), scheduled re-checks with expiry webhooks.
