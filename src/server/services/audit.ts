import "server-only";
import { and, desc, eq, gte, lt, lte, sql, type SQL } from "drizzle-orm";
import { db, type Executor } from "@/server/db";
import { auditLog, users } from "@/server/db/schema";

export type AuditEntry = {
  userId?: string | null;
  /** Dotted verb, e.g. document.update, field.promote, option.add. */
  action: string;
  entity: string;
  entityId?: string | null;
  detail?: Record<string, unknown>;
};

/**
 * Append-only audit trail. Never pass secret material in `detail`
 * (see CLAUDE.md non-negotiables).
 */
export async function writeAudit(entry: AuditEntry, tx?: Executor): Promise<void> {
  const exec = tx ?? db;
  await exec.insert(auditLog).values({
    userId: entry.userId ?? null,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    detail: entry.detail ?? null,
  });
}

export type AuditRow = {
  id: number;
  action: string;
  entity: string;
  entityId: string | null;
  detail: Record<string, unknown> | null;
  createdAt: Date;
  userEmail: string | null;
};

export type AuditFilters = {
  action?: string | undefined;
  entity?: string | undefined;
  userId?: string | undefined;
  /** Inclusive ISO date, e.g. 2026-03-01. */
  from?: string | undefined;
  to?: string | undefined;
  limit?: number | undefined;
  /** Keyset: the id of the last row on the previous page. */
  before?: number | undefined;
};

/** Newest first. The trail is append-only, so paging back by id is stable. */
export async function listAuditLog(filters: AuditFilters = {}): Promise<AuditRow[]> {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const where: SQL[] = [];

  if (filters.action) where.push(eq(auditLog.action, filters.action));
  if (filters.entity) where.push(eq(auditLog.entity, filters.entity));
  if (filters.userId) where.push(eq(auditLog.userId, filters.userId));
  if (filters.before) where.push(lt(auditLog.id, filters.before));
  if (filters.from) where.push(gte(auditLog.createdAt, new Date(`${filters.from}T00:00:00Z`)));
  if (filters.to) where.push(lte(auditLog.createdAt, new Date(`${filters.to}T23:59:59.999Z`)));

  return db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      entity: auditLog.entity,
      entityId: auditLog.entityId,
      detail: auditLog.detail,
      createdAt: auditLog.createdAt,
      userEmail: users.email,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
    .where(where.length > 0 ? and(...where) : undefined)
    .orderBy(desc(auditLog.id))
    .limit(limit);
}

/** Distinct actions seen so far, for the filter dropdown. */
export async function listAuditActions(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ action: auditLog.action })
    .from(auditLog)
    .orderBy(sql`${auditLog.action} asc`);
  return rows.map((row) => row.action);
}
