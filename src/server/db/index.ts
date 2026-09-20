import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/lib/env";
import * as schema from "./schema";

declare global {
  // Reuse the pool across dev hot reloads instead of leaking a pool per reload.
  var __bothyPool: Pool | undefined;
}

const pool = globalThis.__bothyPool ?? new Pool({ connectionString: env.DATABASE_URL, max: 10 });
if (env.NODE_ENV !== "production") globalThis.__bothyPool = pool;

export const db = drizzle(pool, { schema });
export { schema };

/** A transaction handle, as handed to the `db.transaction` callback. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Anything that can run a query: the pool-backed db or an open transaction. */
export type Executor = typeof db | Tx;
