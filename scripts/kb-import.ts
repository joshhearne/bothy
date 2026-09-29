/**
 * Imports a knowledge base archive that is already on this machine, without
 * going through the browser:
 *
 *   npx tsx --conditions react-server scripts/kb-import.ts "Calder Ridge KB" ./export.zip
 *
 * The collection is created if it does not exist. Running it again with a
 * newer export updates what changed and skips the rest.
 */
import "dotenv/config";
import { resolve } from "node:path";
import { statSync } from "node:fs";

const [name, file] = process.argv.slice(2);
if (!name || !file) {
  console.error('usage: kb-import "<collection name>" <archive.zip>');
  process.exit(2);
}

const path = resolve(file);
const size = statSync(path).size;

const { db } = await import("../src/server/db");
const { kbCollections } = await import("../src/server/db/schema");
const { eq } = await import("drizzle-orm");
const { createCollection } = await import("../src/server/services/kb");
const { createImportRecord, importArchive } = await import("../src/server/services/kb-import");

const [existing] = await db
  .select({ id: kbCollections.id })
  .from(kbCollections)
  .where(eq(kbCollections.name, name))
  .limit(1);
const collectionId = existing?.id ?? (await createCollection({ name }, null));

const importId = await createImportRecord({
  collectionId,
  source: "upload",
  filename: path.split("/").pop() ?? null,
  expectedBytes: size,
  actorId: null,
  status: "running",
});

const started = Date.now();
const summary = await importArchive({ file: path, collectionId, importId, actorId: null });
const { failures, ...counts } = summary;

console.log(JSON.stringify(counts, null, 2));
for (const failure of failures) console.log(`failed: ${failure.path} — ${failure.reason}`);
console.log(`${((Date.now() - started) / 1000).toFixed(1)}s`);
process.exit(summary.failed > 0 ? 1 : 0);
