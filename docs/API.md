# API v1

Base: `/api/v1`. JSON. Auth: `Authorization: Bearer <api_key>`. The key is also
accepted on its own, as `Authorization: <api_key>` or `X-API-Key: <api_key>`.
Spec generated from Zod schemas and served at `/api/v1/openapi.json`.
Cursor pagination: `?limit=50&cursor=...`, response has `next_cursor`.

## Resources
```
GET    /companies                  ?q=&external_system=&external_id=
POST   /companies
GET    /companies/:id
PATCH  /companies/:id
GET    /companies/:id/locations
GET    /companies/:id/documents    ?doc_type=&location_id=

POST   /locations
GET    /locations/:id
PATCH  /locations/:id

GET    /doc-types                  (includes template fields)
GET    /doc-types/:id

GET    /documents/:id              (resolved values + raw IDs)
POST   /documents
PATCH  /documents/:id              (partial field_values merge)
GET    /documents/:id/revisions

GET    /option-lists/:id/items
POST   /option-lists/:id/items

GET    /search                     ?q=&company_id=&doc_type=
```

## Company scope
A key is created with either every company or a named set. Everything below is
filtered by it: lists omit what the key may not see, and a single record it may
not see answers `404 not_found` — the same answer a missing id gets, so a key
cannot be used to find out which companies exist. `POST /companies` with a
restricted key answers `403 forbidden`, since the key could not see what it
created.

## PSA integration endpoints
The main use case: a ticket in any PSA needs to show that client's docs.
```
PUT    /external-refs              { entity, entity_id, system, external_id }  (upsert)
GET    /lookup                     ?system=halopsa&entity=company&external_id=123
                                   -> the company plus its locations and documents summary
```
Also support deep links a PSA can embed without the API:
`/go/{system}/company/{external_id}` redirects to the matching company page.

## Vault (requires `secrets:reveal` scope, off by default)
```
GET    /vault/items                ?company_id=&q=      (metadata only, scoped to mapped collection)
POST   /vault/items/:item_id/reveal   { document_id, field_id }  -> { password }  (audited, no-store)
POST   /vault/items/:item_id/totp     { document_id, field_id }  -> { code, period_remaining }
```
Secrets never appear in document, revision, search, export, or webhook payloads.

## Webhooks
Events: `company.created|updated`, `location.created|updated`,
`document.created|updated|archived`, `field.promoted`.

Payload:
```json
{ "event": "document.updated", "occurred_at": "...", "data": { ... resolved document ... } }
```
Headers: `X-Bothy-Event`, `X-Bothy-Delivery`, `X-Bothy-Signature: sha256=<hmac>`.
Retries with exponential backoff, up to 8 attempts.

## MCP
`POST /api/mcp`, Streamable HTTP with JSON responses, authenticated by the same
API keys with the `read` scope:

| Tool | What it returns |
|---|---|
| `search_documents`, `get_document` | Documentation, secrets redacted |
| `list_companies`, `get_company`, `list_doc_types` | The hierarchy and the templates |
| `list_kb_collections` | Knowledge base collections; with `collection_id`, its categories |
| `search_kb` | One result per article: the passage that matched, and `source_url` |
| `get_kb_article` | An article in chunks; follow `next_chunk` for a long one |
| `list_kb_articles` | A collection's articles with their `external_id` |
| `upsert_kb_article` | Writes an article, replacing the one with the same `external_id` |
| `archive_kb_article` | Takes an article out of the collection; nothing is deleted |

The last two are offered only to a key granted write on a collection, under
Admin → Knowledge base → the collection → API key access, and work only there.

A knowledge base collection kept to named companies is seen only by a key with
access to one of them, and no key sees a collection with MCP turned off.

## Knowledge base import (administrators, session-authenticated)
Used by Admin → Knowledge base. Not part of `/api/v1` and not reachable with an
API key.
```
POST   /api/kb/imports                { collectionId, filename, size } -> { id, pieceBytes }
PUT    /api/kb/imports/:id?offset=N   raw bytes of one piece           -> { received_bytes }
POST   /api/kb/imports/:id/complete                                    -> 202, import runs on
GET    /api/kb/imports/:id                                             -> status and counts
DELETE /api/kb/imports/:id            abandons an upload
```
A piece out of order answers `409` with the `received_bytes` to resume from.
An archive already on the server can be imported without the browser:
`npx tsx --conditions react-server scripts/kb-import.ts "<collection>" <file.zip>`.
