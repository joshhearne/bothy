/**
 * Imports a knowledge base archive that is already on this machine, without
 * going through the browser:
 *
 *   npx tsx --conditions react-server scripts/kb-import.ts "Calder Ridge KB" ./export.zip ["Manuals"] [--ignore-manifest] [--force]
 *
 * A third argument is the category for every article in the archive; without
 * it, the archive's top folder names the category of articles that have none.
 * --ignore-manifest opens every file and judges it by its content, for an
 * export whose files changed without their dates changing. --force writes
 * every article again whether or not it changed, for when what Trove KB
 * derives from a body (a runbook's steps, say) has changed.
 *
 * The collection is created if it does not exist. Running it again with a
 * newer export updates what changed and skips the rest.
 */
import "dotenv/config";
import { resolve } from "node:path";
import { statSync } from "node:fs";

const flags = new Set(process.argv.slice(2).filter((arg) => arg.startsWith("--")));
const [name, file, category] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
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
  category: category ?? null,
});

const started = Date.now();
const summary = await importArchive({
  file: path,
  collectionId,
  importId,
  actorId: null,
  category: category ?? null,
  ignoreManifest: flags.has("--ignore-manifest"),
  force: flags.has("--force"),
});
const { failures, ...counts } = summary;

console.log(JSON.stringify(counts, null, 2));
for (const failure of failures) console.log(`failed: ${failure.path} — ${failure.reason}`);
console.log(`${((Date.now() - started) / 1000).toFixed(1)}s`);
process.exit(summary.failed > 0 ? 1 : 0);
