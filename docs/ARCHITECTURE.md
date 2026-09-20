# Architecture

## Stack
| Layer | Choice | Why |
|---|---|---|
| App | Next.js (App Router), TypeScript | One deployable for UI + API |
| DB | PostgreSQL 16 | JSONB for field values, built-in full-text search |
| ORM | Drizzle | Typed, SQL-first, easy migrations. `db/schema.sql` is the reference model |
| Auth | Better Auth | Local accounts + OIDC (Entra, Google, Authentik) |
| Editor | TipTap | Rich text and markdown input in one component |
| Drag and drop | dnd-kit | Field reordering |
| UI | Tailwind + shadcn/ui | Fast, accessible, easy for contributors |
| Validation | Zod | Shared between UI, API, and OpenAPI generation |
| Search | Postgres tsvector | No extra service. Meilisearch optional later |
| Files | Local volume or S3-compatible | Driver set via env |

Single container plus Postgres, with an optional bw-serve sidecar for Bitwarden/Vaultwarden. No Redis, no queue service. Webhook retries run from a lightweight in-process worker polling `webhook_deliveries`.

## Core concepts
- **Company** > **Location** > **Document**. A doc type's `scope` decides whether its documents attach to a company or a location.
- **Doc type** = template. Owns an ordered set of fields.
- **Field** belongs to a doc type (template field) OR a single document (local field). Never both.
- **Promote**: moving a local field onto its doc type. One UPDATE. Existing docs of that type get the new empty field.
- **Option list**: shared dropdown source. Any dropdown field references one. The "+" button inserts an item inline.
- **Values** live in `documents.field_values` keyed by field UUID. Labels can change freely.

## Field value storage
| field_type | Stored as |
|---|---|
| text, url, ip | string |
| markdown | markdown source string |
| richtext | sanitized HTML string (sanitize server-side on write) |
| number | number |
| date | ISO date string |
| boolean | boolean |
| dropdown | option_item UUID |
| multi_dropdown | array of option_item UUIDs |
| doc_link | document UUID (also written to `document_links`) |
| secret_ref | object with vault item/collection ids plus cached non-secret metadata. See VAULT_INTEGRATION.md |

API responses return resolved values (option labels, linked doc titles, rendered HTML for markdown) alongside raw IDs.

## Inline editing rules (the whole point of the project)
1. Edit mode shows every field of the document, template fields first, then local fields, respecting `field_order` if set.
2. "Add field" in edit mode creates a local field on that document.
3. Each local field has "Add to template" (admin/tech permission). Promoting prompts once: confirm label, type, and option list.
4. Dropdowns show a "+" next to the select. Adding an option writes to the shared list and selects it.
5. Drag handle on each field. Reordering a template field in a doc asks: "this doc only" or "update template."
6. Archiving a field hides it everywhere; values stay in JSONB so revisions still render.
7. Every save writes a `document_revisions` row and an `audit_log` row, and queues webhooks.

## Permissions (v1)
- admin: everything, including deleting doc types and managing API keys/webhooks
- tech: create/edit docs, add local fields, promote fields, add dropdown options
- readonly: view only

## Per-company access (v2)
A principal — a signed-in user or an API key — either sees every company or
only the ones granted to it. The role decides what it may *do*; the grant
decides *where*.

- `users.all_companies` / `user_companies`, and `api_keys.all_companies` /
  `api_key_companies`. A new row defaults to false: access is granted, never
  assumed.
- Administrators are never restricted. They are who grants access.
- A user's scope is read from the database on every request, not from the
  session, so revoking a grant applies to the next page load.
- Out of scope reads as **not found**, never as forbidden. Saying a company
  exists but is not yours is itself a disclosure. The one exception is creating
  a company with a restricted key, which is a 403 that says why, because the
  alternative is a company the key could never see.
- Enforcement lives in the service layer: every read of company-owned data
  takes a `CompanyScope`, list queries filter in SQL, and single-record reads
  assert. A restricted principal with no grants matches no row, rather than
  producing an empty `IN ()`.
- It reaches search, backlinks, revisions, attachments, exports, the vault item
  picker, external-ref mapping, `/lookup`, `/go/...` deep links, and the MCP
  tools, which inherit the key's companies.

## Branding
- `instance_branding` holds one row: a portal name, an accent color, and a logo
  key. `companies.accent` / `companies.logo_key` hold the same per client.
- The name replaces the product name in the top bar, the tab title, and the
  sign-in page. The AGPL notice and the source link move to the footer, which
  branding does not touch.
- A logo is stored under a key we generate and served back with the type
  sniffed from its own bytes. PNG, JPEG, and WebP only: an SVG is a document
  that can carry script, and a logo is drawn on every page including sign-in.
- The instance logo is served without authentication, because the sign-in page
  needs it. A company logo is not: it answers 404 outside the caller's company
  scope, like everything else about that company.
- An accent is validated as `#rrggbb`, then re-derived per surface so text on
  it clears WCAG AA in both palettes (`src/lib/brand-color.ts`). Only the
  derived hex values reach a stylesheet, never the string that was typed.
- A company's accent applies to its own pages and documents; the shell keeps
  the instance's, so it stays obvious which portal you are in.

## Security baseline
- Argon2id for local passwords
- API keys: random 32 bytes, shown once, stored as SHA-256 hash, looked up by prefix
- Webhooks signed with HMAC-SHA256 in `X-Bothy-Signature`
- Server-side HTML sanitization for richtext (DOMPurify via jsdom or sanitize-html)
- CSRF protection on session routes, rate limiting on auth and API
