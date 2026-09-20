# API v1

Base: `/api/v1`. JSON. Auth: `Authorization: Bearer <api_key>`.
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
