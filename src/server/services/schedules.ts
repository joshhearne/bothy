import "server-only";
import { z } from "zod";
import { and, asc, eq, isNull, lte, ne, or, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { companies, docTypes, documentSchedules, documents } from "@/server/db/schema";
import { writeAudit } from "@/server/services/audit";
import { queueEvent } from "@/server/services/webhooks";
import { assertDocumentInScope } from "@/server/services/documents";
import { scopeWhere, type CompanyScope } from "@/server/auth/company-scope";
import { addDays, nextDue, statusOf, today, type ScheduleStatus } from "@/server/schedules/due";

/**
 * When a document needs looking at again. A certificate expires once; a UPS
 * battery comes round every so often. Both end up in the same place: a list of
 * what is due, and a webhook when something arrives there.
 */

export const scheduleSchema = z
  .object({
    kind: z.enum(["expiry", "maintenance"]),
    dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
    intervalDays: z.coerce.number().int().min(1).max(3650).optional().nullable(),
    leadDays: z.coerce.number().int().min(0).max(365).default(30),
    note: z.string().trim().max(500).optional().nullable(),
  })
  .refine((input) => input.kind !== "maintenance" || Boolean(input.intervalDays), {
    message: "Say how often it comes round",
    path: ["intervalDays"],
  });

export type ScheduleInput = z.input<typeof scheduleSchema>;

export type DocumentSchedule = {
  documentId: string;
  kind: "expiry" | "maintenance";
  dueOn: string;
  intervalDays: number | null;
  leadDays: number;
  lastDoneOn: string | null;
  note: string | null;
  status: ScheduleStatus;
  daysRemaining: number;
};

export type DueItem = DocumentSchedule & {
  title: string;
  companyId: string;
  companyName: string;
  docTypeName: string;
};

function decorate(row: {
  documentId: string;
  kind: string;
  dueOn: string;
  intervalDays: number | null;
  leadDays: number;
  lastDoneOn: string | null;
  note: string | null;
}): DocumentSchedule {
  const { status, daysRemaining } = statusOf(row.dueOn, row.leadDays);
  return {
    documentId: row.documentId,
    kind: row.kind as "expiry" | "maintenance",
    dueOn: row.dueOn,
    intervalDays: row.intervalDays,
    leadDays: row.leadDays,
    lastDoneOn: row.lastDoneOn,
    note: row.note,
    status,
    daysRemaining,
  };
}

export async function getSchedule(
  documentId: string,
  scope: CompanyScope,
): Promise<DocumentSchedule | null> {
  await assertDocumentInScope(documentId, scope);

  const [row] = await db
    .select()
    .from(documentSchedules)
    .where(eq(documentSchedules.documentId, documentId))
    .limit(1);

  return row ? decorate(row) : null;
}

export async function setSchedule(
  documentId: string,
  input: ScheduleInput,
  actorId: string,
  scope: CompanyScope,
): Promise<void> {
  await assertDocumentInScope(documentId, scope);
  const data = scheduleSchema.parse(input);

  const values = {
    kind: data.kind,
    dueOn: data.dueOn,
    intervalDays: data.kind === "maintenance" ? (data.intervalDays ?? null) : null,
    leadDays: data.leadDays,
    note: data.note ?? null,
    // A new date is a new thing to announce.
    notifiedFor: null,
  };

  await db.transaction(async (tx) => {
    await tx
      .insert(documentSchedules)
      .values({ documentId, ...values })
      .onConflictDoUpdate({ target: documentSchedules.documentId, set: values });

    await writeAudit(
      {
        userId: actorId,
        action: "schedule.set",
        entity: "document",
        entityId: documentId,
        detail: { kind: data.kind, dueOn: data.dueOn, leadDays: data.leadDays },
      },
      tx,
    );
  });
}

export async function clearSchedule(
  documentId: string,
  actorId: string,
  scope: CompanyScope,
): Promise<void> {
  await assertDocumentInScope(documentId, scope);

  await db.transaction(async (tx) => {
    await tx.delete(documentSchedules).where(eq(documentSchedules.documentId, documentId));
    await writeAudit(
      { userId: actorId, action: "schedule.cleared", entity: "document", entityId: documentId },
      tx,
    );
  });
}

/**
 * Marks the job done. A recurring one rolls forward on its own cadence rather
 * than from today, so being a few days late does not move every future date.
 */
export async function markDone(
  documentId: string,
  actorId: string,
  scope: CompanyScope,
): Promise<void> {
  await assertDocumentInScope(documentId, scope);

  const [row] = await db
    .select()
    .from(documentSchedules)
    .where(eq(documentSchedules.documentId, documentId))
    .limit(1);
  if (!row) return;

  const done = today();

  await db.transaction(async (tx) => {
    if (row.kind === "maintenance" && row.intervalDays) {
      await tx
        .update(documentSchedules)
        .set({
          lastDoneOn: done,
          dueOn: nextDue(row.dueOn, row.intervalDays, done),
          notifiedFor: null,
        })
        .where(eq(documentSchedules.documentId, documentId));
    } else {
      // A one-off date has nothing to roll to; it stops asking.
      await tx.delete(documentSchedules).where(eq(documentSchedules.documentId, documentId));
    }

    await writeAudit(
      {
        userId: actorId,
        action: "schedule.done",
        entity: "document",
        entityId: documentId,
        detail: { doneOn: done, kind: row.kind },
      },
      tx,
    );
  });
}

/** Everything asking for attention, in the companies this reader may see. */
export async function listDue(scope: CompanyScope): Promise<DueItem[]> {
  const rows = await db
    .select({
      documentId: documentSchedules.documentId,
      kind: documentSchedules.kind,
      dueOn: documentSchedules.dueOn,
      intervalDays: documentSchedules.intervalDays,
      leadDays: documentSchedules.leadDays,
      lastDoneOn: documentSchedules.lastDoneOn,
      note: documentSchedules.note,
      title: documents.title,
      companyId: documents.companyId,
      companyName: companies.name,
      docTypeName: docTypes.name,
    })
    .from(documentSchedules)
    .innerJoin(documents, eq(documents.id, documentSchedules.documentId))
    .innerJoin(companies, eq(companies.id, documents.companyId))
    .innerJoin(docTypes, eq(docTypes.id, documents.docTypeId))
    .where(
      and(
        isNull(documents.archivedAt),
        scopeWhere(scope, documents.companyId),
        // Inside the lead time, or already past.
        lte(documentSchedules.dueOn, sql`(current_date + ${documentSchedules.leadDays})`),
      ),
    )
    .orderBy(asc(documentSchedules.dueOn))
    .limit(500);

  return rows.map((row) => ({ ...decorate(row), ...row, ...decorate(row) }));
}

/**
 * Announces what has come due since the last look. Called by the in-process
 * worker; each due date is announced once, which is what `notified_for` is for.
 */
export async function announceDue(limit = 50): Promise<number> {
  const rows = await db
    .select({
      documentId: documentSchedules.documentId,
      kind: documentSchedules.kind,
      dueOn: documentSchedules.dueOn,
      leadDays: documentSchedules.leadDays,
      title: documents.title,
      companyId: documents.companyId,
    })
    .from(documentSchedules)
    .innerJoin(documents, eq(documents.id, documentSchedules.documentId))
    .where(
      and(
        isNull(documents.archivedAt),
        lte(documentSchedules.dueOn, sql`(current_date + ${documentSchedules.leadDays})`),
        or(
          isNull(documentSchedules.notifiedFor),
          ne(documentSchedules.notifiedFor, documentSchedules.dueOn),
        ),
      ),
    )
    .limit(limit);

  for (const row of rows) {
    await db.transaction(async (tx) => {
      await queueEvent(
        "document.due",
        {
          id: row.documentId,
          title: row.title,
          company_id: row.companyId,
          kind: row.kind,
          due_on: row.dueOn,
        },
        tx,
      );

      await tx
        .update(documentSchedules)
        .set({ notifiedFor: row.dueOn })
        .where(eq(documentSchedules.documentId, row.documentId));
    });
  }

  return rows.length;
}

/** The date a lead time starts from, for showing in the interface. */
export function warnsFrom(schedule: DocumentSchedule): string {
  return addDays(schedule.dueOn, -schedule.leadDays);
}
