/**
 * Starter data. Idempotent: safe to re-run.
 *
 * Loads the doc type pack from docs/DOCTYPE_STARTER_PACK.md, the option lists
 * those types need, and one internal company to hang documents on.
 *
 * It never creates users — the first admin comes from the setup screen.
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  companies,
  docTypes,
  fields,
  locations,
  optionItems,
  optionLists,
} from "../src/server/db/schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

const pool = new Pool({ connectionString: url, max: 1 });
const db = drizzle(pool);

type FieldType = (typeof fields.$inferInsert)["fieldType"];

type NewField = {
  label: string;
  fieldType: FieldType;
  /** Dropdown types name the shared list they draw from. */
  optionList?: string;
  /** doc_link fields name the doc type they point at. */
  linksTo?: string;
  required?: boolean;
};

type NewDocType = {
  name: string;
  scope: "company" | "location";
  icon: string;
  fields: NewField[];
};

const OPTION_LISTS: Record<string, string[]> = {
  "Vendor Types": ["ISP", "Hardware", "Software", "Distributor", "Carrier"],
  "Circuit Types": ["Fibre", "FTTC", "FTTP", "DSL", "Leased Line", "4G/5G", "Satellite"],
  "Firewall Vendors": ["Fortinet", "Palo Alto", "Sophos", "WatchGuard", "Cisco", "pfSense"],
  "Wi-Fi Security": ["WPA2-Personal", "WPA2-Enterprise", "WPA3-Personal", "WPA3-Enterprise", "Open"],
  "Server Roles": [
    "Domain Controller",
    "File Server",
    "Application Server",
    "Database Server",
    "Hypervisor",
    "Backup Server",
    "Print Server",
  ],
  "Server Operating Systems": [
    "Windows Server 2016",
    "Windows Server 2019",
    "Windows Server 2022",
    "Ubuntu LTS",
    "Debian",
    "RHEL",
    "VMware ESXi",
  ],
};

/** Straight from docs/DOCTYPE_STARTER_PACK.md. */
const DOC_TYPES: NewDocType[] = [
  {
    name: "Vendor",
    scope: "company",
    icon: "building-2",
    fields: [
      { label: "Name", fieldType: "text", required: true },
      { label: "Type", fieldType: "dropdown", optionList: "Vendor Types" },
      { label: "Support Phone", fieldType: "text" },
      { label: "Support URL", fieldType: "url" },
      { label: "Account #", fieldType: "text" },
      { label: "Notes", fieldType: "markdown" },
    ],
  },
  {
    name: "ISP",
    scope: "location",
    icon: "globe",
    fields: [
      { label: "Provider", fieldType: "doc_link", linksTo: "Vendor" },
      { label: "Circuit Type", fieldType: "dropdown", optionList: "Circuit Types" },
      { label: "Circuit ID", fieldType: "text" },
      { label: "Static IPs", fieldType: "text" },
      { label: "Gateway", fieldType: "ip" },
      { label: "Speed Down/Up", fieldType: "text" },
      { label: "Account #", fieldType: "text" },
      { label: "Support Notes", fieldType: "markdown" },
    ],
  },
  {
    name: "Firewall",
    scope: "location",
    icon: "shield",
    fields: [
      { label: "Make", fieldType: "dropdown", optionList: "Firewall Vendors" },
      { label: "Model", fieldType: "text" },
      { label: "Serial", fieldType: "text" },
      { label: "Firmware", fieldType: "text" },
      { label: "LAN IP", fieldType: "ip" },
      { label: "WAN", fieldType: "doc_link", linksTo: "ISP" },
      { label: "Admin URL", fieldType: "url" },
      { label: "Credentials", fieldType: "secret_ref" },
      { label: "Notes", fieldType: "markdown" },
    ],
  },
  {
    name: "Switch",
    scope: "location",
    icon: "network",
    fields: [
      { label: "Make", fieldType: "text" },
      { label: "Model", fieldType: "text" },
      { label: "Serial", fieldType: "text" },
      { label: "Mgmt IP", fieldType: "ip" },
      { label: "VLANs", fieldType: "markdown" },
      { label: "Uplinks", fieldType: "markdown" },
    ],
  },
  {
    name: "Wi-Fi",
    scope: "location",
    icon: "wifi",
    fields: [
      { label: "SSID", fieldType: "text", required: true },
      { label: "Security", fieldType: "dropdown", optionList: "Wi-Fi Security" },
      { label: "VLAN", fieldType: "text" },
      { label: "Controller/AP Model", fieldType: "text" },
      { label: "Credentials", fieldType: "secret_ref" },
    ],
  },
  {
    name: "Printer",
    scope: "location",
    icon: "printer",
    fields: [
      { label: "Make", fieldType: "text" },
      { label: "Model", fieldType: "text" },
      { label: "IP", fieldType: "ip" },
      { label: "Serial", fieldType: "text" },
      { label: "Driver URL", fieldType: "url" },
      { label: "Supplies Vendor", fieldType: "doc_link", linksTo: "Vendor" },
    ],
  },
  {
    name: "Server",
    scope: "location",
    icon: "server",
    fields: [
      { label: "Hostname", fieldType: "text", required: true },
      { label: "Role", fieldType: "multi_dropdown", optionList: "Server Roles" },
      { label: "OS", fieldType: "dropdown", optionList: "Server Operating Systems" },
      { label: "IP", fieldType: "ip" },
      { label: "Host/Hypervisor", fieldType: "text" },
      { label: "Backup Notes", fieldType: "markdown" },
    ],
  },
  {
    name: "Domain/DNS",
    scope: "company",
    icon: "globe-lock",
    fields: [
      { label: "Domain", fieldType: "text", required: true },
      { label: "Registrar", fieldType: "doc_link", linksTo: "Vendor" },
      { label: "DNS Host", fieldType: "doc_link", linksTo: "Vendor" },
      { label: "Expiration", fieldType: "date" },
      { label: "Records Notes", fieldType: "markdown" },
    ],
  },
  {
    name: "M365/Google Tenant",
    scope: "company",
    icon: "cloud",
    fields: [
      { label: "Tenant Name", fieldType: "text", required: true },
      { label: "Tenant ID", fieldType: "text" },
      { label: "Admin URL", fieldType: "url" },
      { label: "Licenses", fieldType: "markdown" },
      { label: "Break-glass", fieldType: "secret_ref" },
    ],
  },
];

async function upsertOptionList(name: string, items: string[]): Promise<string> {
  const [list] = await db
    .insert(optionLists)
    .values({ name })
    .onConflictDoUpdate({ target: optionLists.name, set: { name } })
    .returning({ id: optionLists.id });
  if (!list) throw new Error(`Failed to upsert option list ${name}`);

  await db
    .insert(optionItems)
    .values(items.map((label, index) => ({ listId: list.id, label, sortOrder: index })))
    .onConflictDoNothing({ target: [optionItems.listId, optionItems.label] });

  return list.id;
}

async function upsertDocType(docType: NewDocType): Promise<string> {
  const [row] = await db
    .insert(docTypes)
    .values({ name: docType.name, scope: docType.scope, icon: docType.icon })
    .onConflictDoUpdate({
      target: docTypes.name,
      set: { scope: docType.scope, icon: docType.icon },
    })
    .returning({ id: docTypes.id });
  if (!row) throw new Error(`Failed to upsert doc type ${docType.name}`);
  return row.id;
}

try {
  const listIds = new Map<string, string>();
  for (const [name, items] of Object.entries(OPTION_LISTS)) {
    listIds.set(name, await upsertOptionList(name, items));
  }

  // Doc types first: a doc_link field needs the type it points at to exist.
  const docTypeIds = new Map<string, string>();
  for (const docType of DOC_TYPES) {
    docTypeIds.set(docType.name, await upsertDocType(docType));
  }

  for (const docType of DOC_TYPES) {
    const docTypeId = docTypeIds.get(docType.name) as string;

    const existing = await db
      .select({ label: fields.label })
      .from(fields)
      .where(eq(fields.docTypeId, docTypeId));
    const have = new Set(existing.map((field) => field.label));

    const missing = docType.fields
      .map((field, index) => ({ ...field, sortOrder: index }))
      .filter((field) => !have.has(field.label));

    if (missing.length === 0) continue;

    await db.insert(fields).values(
      missing.map((field) => ({
        docTypeId,
        label: field.label,
        fieldType: field.fieldType,
        sortOrder: field.sortOrder,
        required: field.required ?? false,
        optionListId: field.optionList ? listIds.get(field.optionList) : undefined,
        linkDocTypeId: field.linksTo ? docTypeIds.get(field.linksTo) : undefined,
      })),
    );
  }

  const [company] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(eq(companies.isInternal, true))
    .limit(1);

  const companyId =
    company?.id ??
    (
      await db
        .insert(companies)
        .values({ name: "Internal IT", isInternal: true, notes: "Your own organization." })
        .returning({ id: companies.id })
    )[0]?.id;

  if (!companyId) throw new Error("Failed to create the internal company");

  const [location] = await db
    .select({ id: locations.id })
    .from(locations)
    .where(eq(locations.companyId, companyId))
    .limit(1);

  if (!location) {
    await db.insert(locations).values({ companyId, name: "Head Office" });
  }

  console.log(
    `seed complete: ${DOC_TYPES.length} doc types, ${Object.keys(OPTION_LISTS).length} option lists`,
  );
} finally {
  await pool.end();
}
