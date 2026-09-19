import "server-only";
import { db, type Executor } from "@/server/db";
import { auditLog } from "@/server/db/schema";

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
