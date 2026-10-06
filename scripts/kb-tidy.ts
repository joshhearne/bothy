/**
 * Tidies the Markdown of articles imported before the importer tidied them:
 * numbered steps that a picture or a note had cut in two, a site's own menu
 * of anchor links, numbered section titles kept apart from their numbers.
 *
 *   npx tsx --conditions react-server scripts/kb-tidy.ts "Calder Ridge KB" [--dry-run]
 *   npx tsx --conditions react-server scripts/kb-tidy.ts --all [--dry-run]
 *
 * Articles written through a key are never touched; neither is the source
 * hash, so the next import still knows what changed upstream.
 */
import "dotenv/config";

const flags = new Set(process.argv.slice(2).filter((arg) => arg.startsWith("--")));
const [name] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
if (!name && !flags.has("--all")) {
  console.error('usage: kb-tidy "<collection name>" | --all  [--dry-run]');
  process.exit(2);
}

const { db } = await import("../src/server/db");
const { kbCollections } = await import("../src/server/db/schema");
const { eq } = await import("drizzle-orm");
const { tidyStoredArticles } = await import("../src/server/services/kb-import");

const collections = await db
  .select({ id: kbCollections.id, name: kbCollections.name })
  .from(kbCollections)
  .where(name ? eq(kbCollections.name, name) : undefined);
if (collections.length === 0) {
  console.error(`No collection named ${name}`);
  process.exit(1);
}

const dryRun = flags.has("--dry-run");
for (const collection of collections) {
  const summary = await tidyStoredArticles(collection.id, {
    dryRun,
    log: (line) => console.log(`  ${line}`),
  });
  console.log(
    `${collection.name}: ${summary.changed} of ${summary.seen} ${dryRun ? "would change" : "changed"}`,
  );
}
process.exit(0);
