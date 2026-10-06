/**
 * Runs a knowledge base connector now, without waiting for its schedule or
 * going through the browser:
 *
 *   npx tsx --conditions react-server scripts/kb-connector-run.ts <connector id>
 *
 * The run is recorded like any other, as the first admin.
 */
import "dotenv/config";

const [id] = process.argv.slice(2);
if (!id) {
  console.error("usage: kb-connector-run <connector id>");
  process.exit(2);
}

const { db } = await import("../src/server/db");
const { users } = await import("../src/server/db/schema");
const { eq } = await import("drizzle-orm");
const { runConnector } = await import("../src/server/services/kb-connectors");

const [admin] = await db
  .select({ id: users.id })
  .from(users)
  .where(eq(users.role, "admin"))
  .limit(1);

const started = Date.now();
const { failures, ...counts } = await runConnector(id, admin?.id ?? null);
console.log(JSON.stringify(counts));
for (const failure of failures.slice(0, 10)) console.log(`failed: ${failure.path}: ${failure.reason}`);
console.log(`${((Date.now() - started) / 1000).toFixed(1)}s`);
process.exit(0);
