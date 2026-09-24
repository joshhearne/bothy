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

## Schedules
`document_schedules` is one row per document: a kind (`expiry` or
`maintenance`), the next date, a lead time, and for a recurring job how often
it comes round. Dates are calendar days, not instants — a certificate expires
on a date, and the reader's timezone should not decide whether it is overdue.

- The worker announces what has come due as a `document.due` webhook, once per
  date (`notified_for`). `/api/internal/webhooks` does the same pass for
  deployments with no timer, which is how a Worker deployment gets them at all.
- Marking a recurring job done steps from the date that *was* due, catching up
  in whole intervals if it was missed for months, so lateness never compounds
  and no pile of missed dates is left behind (`src/server/schedules/due.ts`).

## Administration
Admin is its own route group with a secondary rail, not a section of the
primary one: the primary rail is the documentation, which is what people come
for. `instance_settings` is a single row holding what an operator chooses once
— today the default locale, which sits between the reader's cookie and
`APP_LOCALE`. Webhooks live under Notifications, since that is the job they do;
`/admin/webhooks` redirects there.

## Branding
- `instance_branding` holds one row: a portal name, an accent color, and a logo
  key. `companies.accent` / `companies.logo_key` hold the same per client.
- The name replaces the product name in the top bar, the tab title, and the
  sign-in page.
- The footer credit ("Powered by Bothy | Hearne Technologies") names the
  product and its maker, is the same on every install, and is optional:
  `instance_branding.show_powered_by`, on by default. The AGPL notice and the
  source link beside it are not optional, since §13 asks for them.
- A logo is stored under a key we generate and served back with the type
  sniffed from its own bytes. PNG, JPEG, and WebP only: an SVG is a document
  that can carry script, and a logo is drawn on every page including sign-in.
- The instance logo is served without authentication, because the sign-in page
  needs it. A company logo is not: it answers 404 outside the caller's company
  scope, like everything else about that company.
- Branding states which mode it was drawn for (`scheme`), and may carry a
  second logo and a second color for the other mode.
- A color stated for a mode is used in that mode **exactly as given**: an
  operator saying "this is our dark blue for dark mode" means it. The mode
  nobody stated is derived from the one they did, moved far enough from that
  surface to clear WCAG AA (`src/lib/brand-color.ts`). Only hex values reach a
  stylesheet, never the string that was typed. The accent is a fill with its
  label colour computed against it, never text on the page background, so an
  exact brand colour cannot make anything unreadable.
- Both logos are rendered and CSS shows one, keyed on the theme, so the right
  one is there in the first paint and keeps up when a reader's machine turns
  dark at sunset. With one logo, it is shown in both.
- The palette aliases are declared for `:root` **and any element with
  `data-theme`**, because `light-dark()` resolves where the declaration sits
  and a custom property inherits already resolved. That is what lets the
  branding screen render both themes side by side for real rather than
  illustrating them.
- A company's accent applies to its own pages and documents; the shell keeps
  the instance's, so it stays obvious which portal you are in.

## Attachments
- What a file is comes from its own bytes, never from the browser's declared
  type or the extension (`src/server/uploads/accept.ts`).
- Images: PNG, JPEG, GIF, WebP, AVIF. HEIC and HEIF are converted to JPEG on
  the way in and stored with a `.jpg` name, because phones produce them and
  almost nothing else draws them.
- Documents: PDF, the OOXML formats (docx/xlsx/pptx), CSV, Markdown, plain
  text. Text has no signature, so the extension proposes and the bytes confirm.
- Refused: macro-enabled Office (any OOXML containing `vbaProject.bin`,
  whatever it is named), legacy OLE2 Office, plain zips, and everything else.
- The HEIC decoder is imported through a runtime specifier so the Worker bundle
  does not carry 8 MB of WebAssembly it may not execute. That hides it from
  dependency tracing, so `next.config.ts` names the whole chain; a unit test
  checks the two stay in step.
- On Workers, conversion is refused with a message rather than attempted:
  `WebAssembly.compile` is not allowed there.

## Shared lists versus links
A `doc_link` field points at a document, and a document belongs to one company.
That is right for "which circuit is this firewall on" and wrong for "who is the
registrar": an MSP would re-create Cloudflare for every client.

The rule the starter pack follows: if the answer is a *name* shared across
clients, it is a dropdown on an instance-wide option list. If it is a
*relationship* to that client's own record, it stays a `doc_link`. So Registrar,
DNS Host, and ISP Provider draw on shared lists, while Firewall → WAN still
links to that company's ISP document. An option list belongs to the doc type's
field, never to a company, and anyone editing a document can add to it inline.

## Domain checks
A record whose doc type marks a field as holding a domain can look that domain
up: DNS records, the TLS certificate, the registry's own registration record
over RDAP, and whether SPF, DMARC and DKIM are published.

- `fields.domain_role` is one of `domain`, `expiry`, `registrar`, `dns_host`.
  The feature is therefore not wired to one doc type's labels: point it at a
  field on a doc type of your own and it works there.
- Checks run when somebody asks and the result is kept in `domain_checks`, so
  reading a page costs no lookups. Nothing runs in the background.
- Running one needs the document-editing permission, because it is outbound
  traffic sent on the instance's behalf, and the whole instance shares one
  budget of 30 runs a minute.
- **The domain is user input, so a lookup is an SSRF vector.** Names resolve
  first, anything that is not a public address is dropped, and the TLS
  connection is made to the vetted address with the name presented for SNI —
  which also closes DNS rebinding. See `src/server/domain/addresses.ts`.
- A finding never edits the record on its own. RDAP's registrar and expiry and
  the NS answer are offered beside the field, and accepting one is an ordinary
  save with a revision and an audit entry. A name that is not yet in a shared
  dropdown is added to it rather than refused, and an existing option wins even
  when the wording differs, so "GoDaddy.com, LLC" fills in the "GoDaddy"
  already on the list.
- DNS and TLS need Node, so on Workers those sections report that they are
  unavailable rather than failing. RDAP is plain HTTPS and works anywhere.

## Rack elevations
A doc type marked `is_rack` gives its documents an elevation: a size, whether
the rear is used, and what is mounted where.

- `racks` holds the size and the **numbering direction**. Rails are numbered
  from the bottom in most rooms and the top in some, so each rack says which it
  is rather than the software deciding; the drawing follows the rack.
- `rack_mounts` holds one row per thing: a document when it is written up, a
  plain label when it never will be (a patch panel, a shelf), its lowest unit,
  its height, and which face.
- Colour comes from the kind of thing, not the thing: `rack_type_colors` with
  no company is the MSP default, with one it is that client's override. The
  client wins, then the MSP, then a built-in palette whose every pair is far
  enough apart to tell apart in print.
- "Too close" is measured perceptually in Oklab, not by comparing hex digits,
  because two different numbers can be the same colour to a reader
  (`src/server/racks/colors.ts`). Three things are warned about: colours a
  reader could not distinguish, an override that has landed on a colour already
  in use here — where the fix is to move the override, which nobody would think
  to look for — and two things claiming the same unit.
- The drawing is SVG, generated from a pure function and served as a file, so
  the page, the print, and the download are the same picture. Every label is
  escaped and a colour that does not parse is drawn grey rather than written
  into the file. The URL carries a signature of what the rack contains, or a
  browser would keep showing the rack as it was.

## Security baseline
- Argon2id for local passwords
- API keys: random 32 bytes, shown once, stored as SHA-256 hash, looked up by prefix
- Webhooks signed with HMAC-SHA256 in `X-Bothy-Signature`
- Server-side HTML sanitization for richtext (DOMPurify via jsdom or sanitize-html)
- CSRF protection on session routes, rate limiting on auth and API
