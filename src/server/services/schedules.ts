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
  /** Still the schedule its doc type stamped in, rather than one set here. */
  fromDocType: boolean;
};

/** What a doc type gives every document it makes. */
export type DocTypeSchedule = {
  kind: "expiry" | "maintenance";
  dueDays: number;
  intervalDays: number | null;
  leadDays: number;
};

export const docTypeScheduleSchema = z
  .object({
    kind: z.enum(["expiry", "maintenance", "none"]).default("none"),
    dueDays: z.coerce.number().int().min(1).max(3650).optional().nullable(),
    intervalDays: z.coerce.number().int().min(1).max(3650).optional().nullable(),
    leadDays: z.coerce.number().int().min(0).max(365).default(30),
  })
  .refine((input) => input.kind === "none" || Boolean(input.dueDays), {
    message: "Say how long after a document is created the first one falls",
    path: ["dueDays"],
  })
  .refine((input) => input.kind !== "maintenance" || Boolean(input.intervalDays), {
    message: "Say how often it comes round",
    path: ["intervalDays"],
  });

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
  fromDocType?: boolean;
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
    fromDocType: row.fromDocType ?? false,
  };
}

/** The schedule a doc type stamps in, or null when it stamps none. */
export async function getDocTypeSchedule(docTypeId: string): Promise<DocTypeSchedule | null> {
  const [row] = await db
    .select({
      kind: docTypes.scheduleKind,
      dueDays: docTypes.scheduleDueDays,
      intervalDays: docTypes.scheduleIntervalDays,
      leadDays: docTypes.scheduleLeadDays,
    })
    .from(docTypes)
    .where(eq(docTypes.id, docTypeId))
    .limit(1);

  if (!row?.kind || !row.dueDays) return null;
  return {
    kind: row.kind as "expiry" | "maintenance",
    dueDays: row.dueDays,
    intervalDays: row.intervalDays,
    leadDays: row.leadDays ?? 30,
  };
}

export async function setDocTypeSchedule(
  docTypeId: string,
  input: z.input<typeof docTypeScheduleSchema>,
  actorId: string,
): Promise<void> {
  const data = docTypeScheduleSchema.parse(input);
  const none = data.kind === "none";

  const values = {
    scheduleKind: none ? null : data.kind,
    scheduleDueDays: none ? null : (data.dueDays ?? null),
    scheduleIntervalDays: none || data.kind !== "maintenance" ? null : (data.intervalDays ?? null),
    scheduleLeadDays: none ? null : data.leadDays,
  };

  await db.transaction(async (tx) => {
    await tx.update(docTypes).set(values).where(eq(docTypes.id, docTypeId));
    await writeAudit(
      {
        userId: actorId,
        action: "doc_type.schedule_set",
        entity: "doc_type",
        entityId: docTypeId,
        detail: values,
      },
      tx,
    );
  });
}

/**
 * Stamps a doc type's schedule into a document being created. Called inside
 * the same transaction, so a document never exists without the schedule its
 * type says it should have.
 */
export async function stampScheduleFromDocType(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  documentId: string,
  docTypeId: string,
  createdOn: string = today(),
): Promise<void> {
  const [row] = await tx
    .select({
      kind: docTypes.scheduleKind,
      dueDays: docTypes.scheduleDueDays,
      intervalDays: docTypes.scheduleIntervalDays,
      leadDays: docTypes.scheduleLeadDays,
    })
    .from(docTypes)
    .where(eq(docTypes.id, docTypeId))
    .limit(1);

  if (!row?.kind || !row.dueDays) return;

  await tx.insert(documentSchedules).values({
    documentId,
    kind: row.kind,
    dueOn: addDays(createdOn, row.dueDays),
    intervalDays: row.kind === "maintenance" ? row.intervalDays : null,
    leadDays: row.leadDays ?? 30,
    fromDocType: true,
  });
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
    // A new date is a new thing to announce, and a person has taken this over
    // from the doc type that stamped it.
    notifiedFor: null,
    fromDocType: false,
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

/**
 * Stamps a doc type's schedule into documents of that type that have none of
 * their own. Anything already carrying a schedule is left alone: somebody
 * chose it, and a type default is not grounds for overwriting a person.
 */
export async function applyDocTypeScheduleToExisting(
  docTypeId: string,
  actorId: string,
): Promise<number> {
  const schedule = await getDocTypeSchedule(docTypeId);
  if (!schedule) return 0;

  const rows = await db
    .select({ id: documents.id })
    .from(documents)
    .leftJoin(documentSchedules, eq(documentSchedules.documentId, documents.id))
    .where(
      and(
        eq(documents.docTypeId, docTypeId),
        isNull(documents.archivedAt),
        isNull(documentSchedules.documentId),
      ),
    )
    .limit(1000);

  if (rows.length === 0) return 0;
  const from = today();

  await db.transaction(async (tx) => {
    await tx.insert(documentSchedules).values(
      rows.map((row) => ({
        documentId: row.id,
        kind: schedule.kind,
        // Counted from today, since these documents already exist.
        dueOn: addDays(from, schedule.dueDays),
        intervalDays: schedule.kind === "maintenance" ? schedule.intervalDays : null,
        leadDays: schedule.leadDays,
        fromDocType: true,
      })),
    );

    await writeAudit(
      {
        userId: actorId,
        action: "doc_type.schedule_applied",
        entity: "doc_type",
        entityId: docTypeId,
        detail: { documents: rows.length },
      },
      tx,
    );
  });

  return rows.length;
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
