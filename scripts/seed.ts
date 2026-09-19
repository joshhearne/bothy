/**
 * Development seed. Idempotent: safe to re-run.
 * Creates one internal company with a location and two doc types from
 * docs/DOCTYPE_STARTER_PACK.md, enough to exercise Phase 1 and 2 work.
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

type NewField = {
  label: string;
  fieldType: (typeof fields.$inferInsert)["fieldType"];
  optionListName?: string;
};

async function upsertOptionList(name: string, items: string[]): Promise<string> {
  const [list] = await db
    .insert(optionLists)
    .values({ name })
    .onConflictDoUpdate({ target: optionLists.name, set: { name } })
    .returning({ id: optionLists.id });
  if (!list) throw new Error(`Failed to upsert option list ${name}`);

  await db
    .insert(optionItems)
    .values(items.map((label, i) => ({ listId: list.id, label, sortOrder: i })))
    .onConflictDoNothing({ target: [optionItems.listId, optionItems.label] });

  return list.id;
}

async function upsertDocType(
  name: string,
  scope: "company" | "location",
  icon: string,
  templateFields: NewField[],
  optionListIds: Map<string, string>,
): Promise<void> {
  const [docType] = await db
    .insert(docTypes)
    .values({ name, scope, icon })
    .onConflictDoUpdate({ target: docTypes.name, set: { scope, icon } })
    .returning({ id: docTypes.id });
  if (!docType) throw new Error(`Failed to upsert doc type ${name}`);

  const existing = await db
    .select({ label: fields.label })
    .from(fields)
    .where(eq(fields.docTypeId, docType.id));
  const have = new Set(existing.map((f) => f.label));

  const missing = templateFields
    .map((f, i) => ({ ...f, sortOrder: i }))
    .filter((f) => !have.has(f.label));

  if (missing.length > 0) {
    await db.insert(fields).values(
      missing.map((f) => ({
        docTypeId: docType.id,
        label: f.label,
        fieldType: f.fieldType,
        sortOrder: f.sortOrder,
        optionListId: f.optionListName ? optionListIds.get(f.optionListName) : undefined,
      })),
    );
  }
}

try {
  const optionListIds = new Map<string, string>();
  optionListIds.set(
    "Vendor Types",
    await upsertOptionList("Vendor Types", ["ISP", "Hardware", "Software", "Distributor"]),
  );
  optionListIds.set(
    "Circuit Types",
    await upsertOptionList("Circuit Types", ["Fibre", "FTTC", "DSL", "Leased Line", "4G/5G"]),
  );

  await upsertDocType(
    "Vendor",
    "company",
    "building-2",
    [
      { label: "Name", fieldType: "text" },
      { label: "Type", fieldType: "dropdown", optionListName: "Vendor Types" },
      { label: "Support Phone", fieldType: "text" },
      { label: "Support URL", fieldType: "url" },
      { label: "Account #", fieldType: "text" },
      { label: "Notes", fieldType: "markdown" },
    ],
    optionListIds,
  );

  await upsertDocType(
    "ISP",
    "location",
    "globe",
    [
      { label: "Circuit Type", fieldType: "dropdown", optionListName: "Circuit Types" },
      { label: "Circuit ID", fieldType: "text" },
      { label: "Static IPs", fieldType: "text" },
      { label: "Gateway", fieldType: "ip" },
      { label: "Speed Down/Up", fieldType: "text" },
      { label: "Account #", fieldType: "text" },
      { label: "Support Notes", fieldType: "markdown" },
    ],
    optionListIds,
  );

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

  console.log("seed complete");
} finally {
  await pool.end();
}
