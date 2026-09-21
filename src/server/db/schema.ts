/**
 * Drizzle schema. Mirrors db/schema.sql — keep the two in sync (see CLAUDE.md).
 *
 * Auth tables (users/sessions/accounts/verifications) are shaped for Better Auth.
 * Local passwords live in `accounts.password` (Argon2id), not on `users`.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

const now = sql`now()`;

/** Postgres tsvector — Drizzle has no built-in for it. */
const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return "tsvector";
  },
});

/* ---------- Identity ---------- */

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(),
    name: text("name").notNull(),
    role: text("role").notNull().default("tech"),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    canRevealSecrets: boolean("can_reveal_secrets").notNull().default(false),
    /** False means the user sees only what user_companies grants them. */
    allCompanies: boolean("all_companies").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now),
  },
  (t) => [check("users_role_check", sql`${t.role} IN ('admin','tech','readonly')`)],
);

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now),
});

export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  password: text("password"), // Argon2id hash, credential provider only
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now),
});

export const verifications = pgTable("verifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now),
});

/* ---------- Hierarchy ---------- */

export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  isInternal: boolean("is_internal").notNull().default(false),
  notes: text("notes"), // markdown
  brandScheme: text("brand_scheme").notNull().default("light"),
  /** Which vault this client's secrets live in. Null means the default one. */
  vaultProviderId: uuid("vault_provider_id"),
  accent: text("accent"), // #rrggbb, validated in app code
  altAccent: text("alt_accent"),
  logoKey: text("logo_key"),
  logoMime: text("logo_mime"),
  altLogoKey: text("alt_logo_key"),
  altLogoMime: text("alt_logo_mime"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
});

/**
 * Instance branding: one row, held to one row by a boolean primary key that
 * may only be true. A logo is a storage key, never an uploaded filename.
 */
export const instanceBranding = pgTable(
  "instance_branding",
  {
    id: boolean("id").primaryKey().default(true),
    name: text("name"),
    /** Which mode the primary logo and accent were drawn for. */
    scheme: text("scheme").notNull().default("light"),
    /** The "Powered by" credit. On unless an operator turns it off. */
    showPoweredBy: boolean("show_powered_by").notNull().default(true),
    accent: text("accent"),
    /** An exact color for the other mode. Derived from `accent` when null. */
    altAccent: text("alt_accent"),
    logoKey: text("logo_key"),
    logoMime: text("logo_mime"),
    altLogoKey: text("alt_logo_key"),
    altLogoMime: text("alt_logo_mime"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now),
    updatedBy: uuid("updated_by").references(() => users.id),
  },
  (t) => [
    check("instance_branding_singleton", sql`${t.id}`),
    check("instance_branding_scheme_check", sql`${t.scheme} IN ('light','dark')`),
  ],
);

export const locations = pgTable("locations", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  address: text("address"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

/* ---------- Templates (doc types) ---------- */

export const docTypes = pgTable(
  "doc_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull().unique(),
    icon: text("icon"),
    scope: text("scope").notNull().default("location"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [check("doc_types_scope_check", sql`${t.scope} IN ('company','location')`)],
);

export const optionLists = pgTable("option_lists", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
});

export const optionItems = pgTable(
  "option_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listId: uuid("list_id")
      .notNull()
      .references(() => optionLists.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdBy: uuid("created_by").references(() => users.id),
    archivedAt: timestamp("archived_at", { withTimezone: true }), // hide, never hard delete
  },
  (t) => [unique("option_items_list_id_label_key").on(t.listId, t.label)],
);

/* ---------- Documents ---------- */

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    docTypeId: uuid("doc_type_id")
      .notNull()
      .references(() => docTypes.id),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    /** { "<field_id>": value } — keyed by field UUID, never by label. */
    fieldValues: jsonb("field_values").$type<Record<string, unknown>>().notNull().default({}),
    /** Optional per-doc order override: ["<field_id>", ...] */
    fieldOrder: jsonb("field_order").$type<string[] | null>(),
    updatedBy: uuid("updated_by").references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    /** Maintained by the app on save: flattened text of field_values. */
    searchText: text("search_text").notNull().default(""),
    searchVec: tsvector("search_vec").generatedAlwaysAs(
      sql`to_tsvector('english', title || ' ' || search_text)`,
    ),
  },
  (t) => [
    index("documents_values_gin").using("gin", t.fieldValues),
    index("documents_search_idx").using("gin", t.searchVec),
  ],
);

/* ---------- Fields ---------- */

export const FIELD_TYPES = [
  "text",
  "markdown",
  "richtext",
  "number",
  "date",
  "url",
  "ip",
  "boolean",
  "dropdown",
  "multi_dropdown",
  "doc_link",
  "secret_ref",
] as const;

/**
 * One table for template fields AND doc-local fields.
 * "Add to template" = set doc_type_id, clear document_id. That is the whole promote operation.
 */
export const fields = pgTable(
  "fields",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    docTypeId: uuid("doc_type_id").references(() => docTypes.id, { onDelete: "cascade" }),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    fieldType: text("field_type").notNull(),
    optionListId: uuid("option_list_id").references(() => optionLists.id),
    linkDocTypeId: uuid("link_doc_type_id").references((): typeof docTypes.id => docTypes.id),
    required: boolean("required").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    /**
     * What this field means to a domain check: which field holds the domain,
     * and which ones a lookup can offer to fill in. Null for ordinary fields,
     * which is nearly all of them.
     */
    domainRole: text("domain_role"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "fields_domain_role_check",
      sql`${t.domainRole} IS NULL OR ${t.domainRole} IN ('domain','expiry','registrar','dns_host')`,
    ),
    check(
      "fields_field_type_check",
      sql`${t.fieldType} IN ('text','markdown','richtext','number','date','url','ip','boolean','dropdown','multi_dropdown','doc_link','secret_ref')`,
    ),
    check(
      "fields_owner_check",
      sql`(${t.docTypeId} IS NULL) <> (${t.documentId} IS NULL)`,
    ),
  ],
);

/* ---------- History, links, files ---------- */

export const documentRevisions = pgTable("document_revisions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  documentId: uuid("document_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  fieldValues: jsonb("field_values").$type<Record<string, unknown>>().notNull(),
  editedBy: uuid("edited_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
});

/** Derived from doc_link fields, for backlinks. */
export const documentLinks = pgTable(
  "document_links",
  {
    fromDoc: uuid("from_doc")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    toDoc: uuid("to_doc")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    fieldId: uuid("field_id")
      .notNull()
      .references(() => fields.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.fromDoc, t.toDoc, t.fieldId] })],
);

export const attachments = pgTable("attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  storageKey: text("storage_key").notNull(), // local volume or S3 path
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  uploadedBy: uuid("uploaded_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
});

export const auditLog = pgTable("audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: uuid("user_id").references(() => users.id),
  action: text("action").notNull(), // document.update, field.promote, option.add
  entity: text("entity").notNull(),
  entityId: uuid("entity_id"),
  detail: jsonb("detail").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
});

/* ---------- Integrations ---------- */

/** Maps our records to IDs in any external system (PSA, RMM, CRM). */
export const externalRefs = pgTable(
  "external_refs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entity: text("entity").notNull(),
    entityId: uuid("entity_id").notNull(),
    system: text("system").notNull(), // 'halopsa', 'syncro', 'resolvd', free text
    externalId: text("external_id").notNull(),
  },
  (t) => [
    check("external_refs_entity_check", sql`${t.entity} IN ('company','location','document')`),
    unique("external_refs_system_entity_external_id_key").on(t.system, t.entity, t.externalId),
    index("external_refs_entity_idx").on(t.entity, t.entityId),
  ],
);

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(), // "HaloPSA integration"
  prefix: text("prefix").notNull().unique(), // first 8 chars, shown in UI
  keyHash: text("key_hash").notNull(), // sha256 of full key; full key shown once
  scopes: text("scopes").array().notNull().default(sql`'{read}'`),
  createdBy: uuid("created_by").references(() => users.id),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  /** False means the key sees only what api_key_companies grants it. */
  allCompanies: boolean("all_companies").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
});

/**
 * Per-document domain checks: which lookups this record runs, and what the
 * last run found. One row per document, created when somebody first turns a
 * check on.
 */
export const domainChecks = pgTable("domain_checks", {
  documentId: uuid("document_id")
    .primaryKey()
    .references(() => documents.id, { onDelete: "cascade" }),
  dns: boolean("dns").notNull().default(false),
  tls: boolean("tls").notNull().default(false),
  rdap: boolean("rdap").notNull().default(false),
  email: boolean("email").notNull().default(false),
  /** The last result, as rendered. Never anything secret: these are public records. */
  result: jsonb("result"),
  checkedAt: timestamp("checked_at", { withTimezone: true }),
  checkedBy: uuid("checked_by").references(() => users.id),
});

/* ---------- Per-company access ---------- */

export const userCompanies = pgTable(
  "user_companies",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().default(now),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.companyId] }),
    index("user_companies_company_idx").on(t.companyId),
  ],
);

export const apiKeyCompanies = pgTable(
  "api_key_companies",
  {
    apiKeyId: uuid("api_key_id")
      .notNull()
      .references(() => apiKeys.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().default(now),
  },
  (t) => [
    primaryKey({ columns: [t.apiKeyId, t.companyId] }),
    index("api_key_companies_company_idx").on(t.companyId),
  ],
);

export const webhooks = pgTable("webhooks", {
  id: uuid("id").primaryKey().defaultRandom(),
  url: text("url").notNull(),
  secret: text("secret").notNull(), // HMAC-SHA256 signing secret
  events: text("events").array().notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
});

export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  webhookId: uuid("webhook_id")
    .notNull()
    .references(() => webhooks.id, { onDelete: "cascade" }),
  event: text("event").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  statusCode: integer("status_code"),
  attempts: integer("attempts").notNull().default(0),
  nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
});

/* ---------- Vault integration ---------- */

/** Non-secret provider config. Credentials stay in env / Docker secrets. */
export const vaultProviders = pgTable(
  "vault_providers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(), // e.g. "Main Vaultwarden"
    kind: text("kind").notNull(),
    webVaultUrl: text("web_vault_url"), // for deep links
    organizationId: text("organization_id"),
    allowCreate: boolean("allow_create").notNull().default(false),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    status: text("status").notNull().default("unknown"), // ok | locked | unreachable
    enabled: boolean("enabled").notNull().default(true),
  },
  (t) => [
    check("vault_providers_kind_check", sql`${t.kind} IN ('link','bw_serve','bitwarden_public_api','op_connect','hashicorp_kv','passbolt','keeper')`),
  ],
);
