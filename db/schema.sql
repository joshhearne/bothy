-- Bothy data model (PostgreSQL 16+)
-- One instance = one MSP or internal IT team. Companies are clients (or yourself).
--
-- Reference model. src/server/db/schema.ts mirrors this file; the migrations in
-- drizzle/ are what actually run. Change both together.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- Identity ----------
-- Better Auth owns users/sessions/accounts/verifications.
-- Local passwords live in accounts.password (Argon2id), never on users.
CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text UNIQUE NOT NULL,
  name           text NOT NULL,
  role           text NOT NULL DEFAULT 'tech' CHECK (role IN ('admin','tech','readonly')),
  email_verified boolean NOT NULL DEFAULT false,
  image          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      text UNIQUE NOT NULL,
  expires_at timestamptz NOT NULL,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id    text NOT NULL,
  provider_id   text NOT NULL,          -- 'credential' for local accounts, else the OIDC provider
  password      text,                   -- Argon2id hash; null for OIDC-only accounts
  access_token  text,
  refresh_token text,
  id_token      text,
  access_token_expires_at  timestamptz,
  refresh_token_expires_at timestamptz,
  scope         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE verifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier text NOT NULL,
  value      text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- Hierarchy ----------
CREATE TABLE companies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  is_internal boolean NOT NULL DEFAULT false,  -- your own org
  notes       text,                            -- markdown
  archived_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE locations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        text NOT NULL,                   -- e.g. Head Office, Warehouse
  address     text,
  archived_at timestamptz
);

-- ---------- Templates (doc types) ----------
CREATE TABLE doc_types (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,            -- ISP, Firewall, Wi-Fi, Printer
  icon        text,
  scope       text NOT NULL DEFAULT 'location' CHECK (scope IN ('company','location')),
  archived_at timestamptz
);

-- Shared dropdown sources. The "+" button inserts into option_items.
CREATE TABLE option_lists (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE                    -- "ISP Vendors", "Firewall Models"
);

CREATE TABLE option_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id     uuid NOT NULL REFERENCES option_lists(id) ON DELETE CASCADE,
  label       text NOT NULL,
  sort_order  int  NOT NULL DEFAULT 0,
  created_by  uuid REFERENCES users(id),
  archived_at timestamptz,                     -- hide, never hard delete
  UNIQUE (list_id, label)
);

-- ---------- Documents ----------
CREATE TABLE documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_type_id uuid NOT NULL REFERENCES doc_types(id),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
  title       text NOT NULL,
  field_values jsonb NOT NULL DEFAULT '{}',    -- { "<field_id>": value }
  field_order  jsonb,                          -- optional per-doc order override: ["<field_id>", ...]
  updated_by  uuid REFERENCES users(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX documents_values_gin ON documents USING gin (field_values);

-- ---------- Fields ----------
-- One table for template fields AND doc-local fields.
-- "Add to template" = set doc_type_id, clear document_id. That's the whole promote operation.
CREATE TABLE fields (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_type_id    uuid REFERENCES doc_types(id) ON DELETE CASCADE,
  document_id    uuid REFERENCES documents(id) ON DELETE CASCADE,
  label          text NOT NULL,
  field_type     text NOT NULL CHECK (field_type IN (
                   'text','markdown','richtext','number','date','url','ip',
                   'boolean','dropdown','multi_dropdown','doc_link','secret_ref')),
  option_list_id uuid REFERENCES option_lists(id),     -- dropdown types
  link_doc_type_id uuid REFERENCES doc_types(id),      -- doc_link: e.g. ISP -> Vendor doc
  required       boolean NOT NULL DEFAULT false,
  sort_order     int NOT NULL DEFAULT 0,
  archived_at    timestamptz,                  -- values stay in jsonb, just hidden
  CHECK ((doc_type_id IS NULL) <> (document_id IS NULL))
);

-- ---------- History, links, files ----------
CREATE TABLE document_revisions (
  id           bigserial PRIMARY KEY,
  document_id  uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  title        text NOT NULL,
  field_values jsonb NOT NULL,
  edited_by    uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE document_links (               -- derived from doc_link fields, for backlinks
  from_doc uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  to_doc   uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  field_id uuid NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
  PRIMARY KEY (from_doc, to_doc, field_id)
);

CREATE TABLE attachments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  filename    text NOT NULL,
  mime_type   text NOT NULL,
  storage_key text NOT NULL,                  -- local volume or S3 path
  size_bytes  bigint NOT NULL,
  uploaded_by uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  user_id    uuid REFERENCES users(id),
  action     text NOT NULL,                   -- document.update, field.promote, option.add
  entity     text NOT NULL,
  entity_id  uuid,
  detail     jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- Search ----------
-- Maintained by the app on save: title + flattened text of field_values.
ALTER TABLE documents ADD COLUMN search_text text NOT NULL DEFAULT '';
ALTER TABLE documents ADD COLUMN search_vec tsvector
  GENERATED ALWAYS AS (to_tsvector('english', title || ' ' || search_text)) STORED;
CREATE INDEX documents_search_idx ON documents USING gin (search_vec);

-- ---------- Integrations ----------
-- Maps our records to IDs in any external system (PSA, RMM, CRM).
-- Lets a ticket in HaloPSA, Syncro, ConnectWise, Resolvd, etc. find "its" company docs.
CREATE TABLE external_refs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity      text NOT NULL CHECK (entity IN ('company','location','document')),
  entity_id   uuid NOT NULL,
  system      text NOT NULL,                   -- 'halopsa', 'syncro', 'resolvd', free text
  external_id text NOT NULL,
  UNIQUE (system, entity, external_id)
);
CREATE INDEX external_refs_entity_idx ON external_refs (entity, entity_id);

CREATE TABLE api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,                  -- "HaloPSA integration"
  prefix       text NOT NULL UNIQUE,           -- first 8 chars, shown in UI
  key_hash     text NOT NULL,                  -- sha256 of full key; full key shown once
  scopes       text[] NOT NULL DEFAULT '{read}', -- read, write, admin
  created_by   uuid REFERENCES users(id),
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE webhooks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url        text NOT NULL,
  secret     text NOT NULL,                    -- HMAC-SHA256 signing secret
  events     text[] NOT NULL,                  -- document.created, document.updated, ...
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE webhook_deliveries (
  id            bigserial PRIMARY KEY,
  webhook_id    uuid NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event         text NOT NULL,
  payload       jsonb NOT NULL,
  status_code   int,
  attempts      int NOT NULL DEFAULT 0,
  next_retry_at timestamptz,
  delivered_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------- Vault integration ----------
ALTER TABLE users ADD COLUMN can_reveal_secrets boolean NOT NULL DEFAULT false;

-- Non-secret provider config. Credentials stay in env / Docker secrets.
CREATE TABLE vault_providers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,                  -- e.g. "Main Vaultwarden"
  kind          text NOT NULL CHECK (kind IN ('link','bw_serve','bitwarden_public_api')),
  web_vault_url text,                           -- for deep links
  organization_id text,                         -- Bitwarden org id
  allow_create  boolean NOT NULL DEFAULT false, -- create items from docs
  last_sync_at  timestamptz,
  status        text NOT NULL DEFAULT 'unknown',-- ok | locked | unreachable
  enabled       boolean NOT NULL DEFAULT true
);
-- Company <-> collection mapping uses external_refs (system = 'bitwarden').
-- secret_ref field values hold only item/collection ids and cached non-secret metadata.

-- ---------- Per-company access ----------
-- A principal (user or API key) either sees every company or only the ones
-- granted to it. New rows default to false: access is granted, never assumed.
ALTER TABLE users ADD COLUMN all_companies boolean NOT NULL DEFAULT false;
ALTER TABLE api_keys ADD COLUMN all_companies boolean NOT NULL DEFAULT false;

CREATE TABLE user_companies (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, company_id)
);
CREATE INDEX user_companies_company_idx ON user_companies (company_id);

CREATE TABLE api_key_companies (
  api_key_id uuid NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (api_key_id, company_id)
);
CREATE INDEX api_key_companies_company_idx ON api_key_companies (company_id);
-- Admins are never restricted: they are who grants access in the first place.
