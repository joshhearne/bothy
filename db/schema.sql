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
  kind          text NOT NULL CHECK (kind IN ('link','bw_serve','bitwarden_public_api','op_connect','hashicorp_kv','passbolt','keeper')),
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

-- ---------- Branding ----------
-- One row, ever: the boolean primary key can only be true.
CREATE TABLE instance_branding (
  id           boolean PRIMARY KEY DEFAULT true CHECK (id),
  name         text,                            -- replaces the wordmark
  accent       text,                            -- #rrggbb, validated in app code
  logo_key     text,                            -- storage key, never a filename
  logo_mime    text,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid REFERENCES users(id)
);

ALTER TABLE companies ADD COLUMN accent    text;
ALTER TABLE companies ADD COLUMN logo_key  text;
ALTER TABLE companies ADD COLUMN logo_mime text;

-- ---------- Domain checks ----------
-- A field can declare what it means to a domain lookup, so the feature is not
-- wired to one doc type's labels.
ALTER TABLE fields ADD COLUMN domain_role text
  CHECK (domain_role IS NULL OR domain_role IN ('domain','expiry','registrar','dns_host'));

CREATE TABLE domain_checks (
  document_id uuid PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  dns        boolean NOT NULL DEFAULT false,
  tls        boolean NOT NULL DEFAULT false,
  rdap       boolean NOT NULL DEFAULT false,
  email      boolean NOT NULL DEFAULT false,
  result     jsonb,                          -- last result, public data only
  checked_at timestamptz,
  checked_by uuid REFERENCES users(id)
);

-- ---------- Branding per theme ----------
-- A logo drawn for a light background disappears on a dark one, so branding
-- says which mode its assets were drawn for and may carry a set for the other.
ALTER TABLE instance_branding ADD COLUMN scheme text NOT NULL DEFAULT 'light'
  CHECK (scheme IN ('light','dark'));
ALTER TABLE instance_branding ADD COLUMN alt_accent text;
ALTER TABLE instance_branding ADD COLUMN alt_logo_key text;
ALTER TABLE instance_branding ADD COLUMN alt_logo_mime text;

ALTER TABLE companies ADD COLUMN brand_scheme text NOT NULL DEFAULT 'light'
  CHECK (brand_scheme IN ('light','dark'));
ALTER TABLE companies ADD COLUMN alt_accent text;
ALTER TABLE companies ADD COLUMN alt_logo_key text;
ALTER TABLE companies ADD COLUMN alt_logo_mime text;

-- ---------- A vault per company ----------
-- An MSP inherits whatever each client already uses, so a company may name its
-- own provider. Null means the instance default.
ALTER TABLE companies ADD COLUMN vault_provider_id uuid REFERENCES vault_providers(id);

-- Collection mappings are per provider: 'vault:<provider id>' rather than a
-- single 'bitwarden', so two vaults can both map the same company.

-- The "Powered by" credit is an operator's choice; the licence notice and the
-- source link below it are not, since AGPL-3.0 §13 asks for them.
ALTER TABLE instance_branding ADD COLUMN show_powered_by boolean NOT NULL DEFAULT true;

-- ---------- Racks ----------
CREATE TABLE racks (
  document_id uuid PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  total_u     int NOT NULL DEFAULT 42 CHECK (total_u BETWEEN 1 AND 60),
  has_rear    boolean NOT NULL DEFAULT false,
  -- Rails are numbered from the bottom in most rooms, the top in some.
  numbering   text NOT NULL DEFAULT 'bottom_up' CHECK (numbering IN ('bottom_up','top_down'))
);

CREATE TABLE rack_mounts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rack_id     uuid NOT NULL REFERENCES racks(document_id) ON DELETE CASCADE,
  position_u  int NOT NULL,                       -- lowest unit, as the rails read
  height_u    int NOT NULL DEFAULT 1 CHECK (height_u BETWEEN 1 AND 20),
  face        text NOT NULL DEFAULT 'front' CHECK (face IN ('front','rear','both')),
  document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  label       text,                               -- for what is never documented
  doc_type_id uuid REFERENCES doc_types(id),      -- its kind, when there is no document
  CHECK (document_id IS NOT NULL OR label IS NOT NULL)
);
CREATE INDEX rack_mounts_rack_idx ON rack_mounts (rack_id);

-- A row with no company is the MSP default; with one, that client's override.
CREATE TABLE rack_type_colors (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_type_id uuid NOT NULL REFERENCES doc_types(id) ON DELETE CASCADE,
  company_id  uuid REFERENCES companies(id) ON DELETE CASCADE,
  color       text NOT NULL
);
CREATE UNIQUE INDEX rack_type_colors_global_idx ON rack_type_colors (doc_type_id)
  WHERE company_id IS NULL;
CREATE UNIQUE INDEX rack_type_colors_company_idx ON rack_type_colors (doc_type_id, company_id)
  WHERE company_id IS NOT NULL;

-- Documents of a rack doc type carry an elevation.
ALTER TABLE doc_types ADD COLUMN is_rack boolean NOT NULL DEFAULT false;

-- ---------- Instance settings ----------
-- One row. What an operator picks once, rather than setting in the environment.
CREATE TABLE instance_settings (
  id             boolean PRIMARY KEY DEFAULT true CHECK (id),
  default_locale text,                      -- overrides APP_LOCALE
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid REFERENCES users(id)
);

-- ---------- Schedules ----------
-- When a document needs looking at again: a date that arrives once, or a job
-- that comes round on an interval.
CREATE TABLE document_schedules (
  document_id   uuid PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('expiry','maintenance')),
  due_on        date NOT NULL,
  interval_days int CHECK (interval_days IS NULL OR interval_days BETWEEN 1 AND 3650),
  lead_days     int NOT NULL DEFAULT 30 CHECK (lead_days BETWEEN 0 AND 365),
  last_done_on  date,
  note          text,
  notified_for  date                    -- the due date already announced
);
CREATE INDEX document_schedules_due_idx ON document_schedules (due_on);

-- ---------- Schedules from the doc type ----------
-- Every document of a type starts with the same review schedule. A doc type
-- cannot know an absolute date, so the first one counts from creation day.
ALTER TABLE doc_types ADD COLUMN schedule_kind text
  CHECK (schedule_kind IS NULL OR schedule_kind IN ('expiry','maintenance'));
ALTER TABLE doc_types ADD COLUMN schedule_due_days int
  CHECK (schedule_due_days IS NULL OR schedule_due_days BETWEEN 1 AND 3650);
ALTER TABLE doc_types ADD COLUMN schedule_interval_days int
  CHECK (schedule_interval_days IS NULL OR schedule_interval_days BETWEEN 1 AND 3650);
ALTER TABLE doc_types ADD COLUMN schedule_lead_days int
  CHECK (schedule_lead_days IS NULL OR schedule_lead_days BETWEEN 0 AND 365);

-- Whether a document's schedule is still the one its type stamped in.
ALTER TABLE document_schedules ADD COLUMN from_doc_type boolean NOT NULL DEFAULT false;
