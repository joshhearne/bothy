import "server-only";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { env } from "@/lib/env";
import { isWorkers } from "@/lib/runtime";
import * as schema from "./schema";

type Database = NodePgDatabase<typeof schema>;

declare global {
  // Reuse the pool across dev hot reloads instead of leaking a pool per reload.
  var __bothyPool: Pool | undefined;
}

/* ---------- Node: one pool for the life of the process ---------- */

let nodeDatabase: Database | undefined;

function nodeDb(): Database {
  if (nodeDatabase) return nodeDatabase;

  const pool = globalThis.__bothyPool ?? new Pool({ connectionString: env.DATABASE_URL, max: 10 });
  if (env.NODE_ENV !== "production") globalThis.__bothyPool = pool;

  nodeDatabase = drizzle(pool, { schema });
  return nodeDatabase;
}

/* ---------- Workers: one pool per request ---------- */

/**
 * A Worker may not carry a socket from one request into the next, so a pool
 * that lives at module scope fails on every request that reuses it. The pool
 * is therefore created per request and cached against that request's
 * execution context, which the runtime discards when the request ends.
 * Hyperdrive keeps the real connections warm on Cloudflare's side.
 */
const perRequest = new WeakMap<object, Database>();

function workersDb(): Database {
  const { env: bindings, ctx } = getCloudflareContext() as unknown as {
    env: { HYPERDRIVE?: { connectionString: string } };
    ctx: object;
  };

  const existing = perRequest.get(ctx);
  if (existing) return existing;

  const connectionString = bindings.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
  const database = drizzle(new Pool({ connectionString, max: 1 }), { schema });
  perRequest.set(ctx, database);
  return database;
}

function current(): Database {
  return isWorkers() ? workersDb() : nodeDb();
}

/**
 * The database handle. A proxy so every call site keeps working unchanged
 * while the instance behind it is chosen per runtime, and per request on
 * Workers.
 */
export const db = new Proxy({} as Database, {
  get(_target, property, receiver) {
    const instance = current();
    const value = Reflect.get(instance, property, receiver);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});

/** A transaction handle, as handed to the `db.transaction` callback. */
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Anything that can run a query: the pooled db or an open transaction. */
export type Executor = Database | Tx;
