import "server-only";
import { z } from "zod";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, type Executor } from "@/server/db";
import { optionItems, optionLists } from "@/server/db/schema";
import { writeAudit } from "@/server/services/audit";
import { NotFoundError } from "@/server/services/companies";
import type { OptionIndex } from "@/server/fields/values";

export const optionListInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
});

export const optionItemInputSchema = z.object({
  label: z.string().trim().min(1, "Label is required").max(200),
});

export type OptionListSummary = { id: string; name: string; itemCount: number };
export type OptionItemRow = { id: string; label: string; sortOrder: number; archivedAt: Date | null };

export async function listOptionLists(): Promise<OptionListSummary[]> {
  const counts = db
    .select({ listId: optionItems.listId, n: sql<number>`count(*)::int`.as("item_count") })
    .from(optionItems)
    .where(isNull(optionItems.archivedAt))
    .groupBy(optionItems.listId)
    .as("item_counts");

  return db
    .select({
      id: optionLists.id,
      name: optionLists.name,
      itemCount: sql<number>`coalesce(${counts.n}, 0)`,
    })
    .from(optionLists)
    .leftJoin(counts, eq(counts.listId, optionLists.id))
    .orderBy(asc(optionLists.name));
}

export async function getOptionList(id: string) {
  const [list] = await db.select().from(optionLists).where(eq(optionLists.id, id)).limit(1);
  if (!list) return null;
  const items = await listOptionItems(id, { includeArchived: true });
  return { ...list, items };
}

export async function listOptionItems(
  listId: string,
  { includeArchived = false }: { includeArchived?: boolean } = {},
): Promise<OptionItemRow[]> {
  return db
    .select({
      id: optionItems.id,
      label: optionItems.label,
      sortOrder: optionItems.sortOrder,
      archivedAt: optionItems.archivedAt,
    })
    .from(optionItems)
    .where(
      includeArchived
        ? eq(optionItems.listId, listId)
        : and(eq(optionItems.listId, listId), isNull(optionItems.archivedAt)),
    )
    .orderBy(asc(optionItems.sortOrder), asc(optionItems.label));
}

/**
 * Active items for the given lists, in the shape the field validators want.
 * Archived items are left out, so an archived option can no longer be chosen
 * while documents that already hold it keep rendering (see resolveOptionLabels).
 */
export async function loadOptionIndex(listIds: string[], tx?: Executor): Promise<OptionIndex> {
  const index: OptionIndex = new Map();
  const ids = [...new Set(listIds)];
  if (ids.length === 0) return index;

  const exec = tx ?? db;
  const rows = await exec
    .select({ listId: optionItems.listId, id: optionItems.id, label: optionItems.label })
    .from(optionItems)
    .where(and(inArray(optionItems.listId, ids), isNull(optionItems.archivedAt)))
    .orderBy(asc(optionItems.sortOrder), asc(optionItems.label));

  for (const row of rows) {
    const bucket = index.get(row.listId);
    if (bucket) bucket.push({ id: row.id, label: row.label });
    else index.set(row.listId, [{ id: row.id, label: row.label }]);
  }
  return index;
}

/** Every item, archived included, for rendering values that were stored earlier. */
export async function loadOptionLabels(listIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(listIds)];
  if (ids.length === 0) return new Map();

  const rows = await db
    .select({ id: optionItems.id, label: optionItems.label })
    .from(optionItems)
    .where(inArray(optionItems.listId, ids));

  return new Map(rows.map((row) => [row.id, row.label]));
}

export async function createOptionList(
  input: z.input<typeof optionListInputSchema>,
  actorId: string,
): Promise<{ id: string }> {
  const data = optionListInputSchema.parse(input);

  return db.transaction(async (tx) => {
    const [list] = await tx
      .insert(optionLists)
      .values({ name: data.name })
      .returning({ id: optionLists.id });
    if (!list) throw new Error("Failed to create option list");

    await writeAudit(
      {
        userId: actorId,
        action: "option_list.created",
        entity: "option_list",
        entityId: list.id,
        detail: { name: data.name },
      },
      tx,
    );
    return list;
  });
}

export async function renameOptionList(
  id: string,
  input: z.input<typeof optionListInputSchema>,
  actorId: string,
): Promise<void> {
  const data = optionListInputSchema.parse(input);

  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(optionLists)
      .set({ name: data.name })
      .where(eq(optionLists.id, id))
      .returning({ id: optionLists.id });
    if (!updated) throw new NotFoundError("Option list");

    await writeAudit(
      {
        userId: actorId,
        action: "option_list.updated",
        entity: "option_list",
        entityId: id,
        detail: { name: data.name },
      },
      tx,
    );
  });
}

export class DuplicateOptionError extends Error {
  constructor(label: string) {
    super(`"${label}" is already on this list`);
    this.name = "DuplicateOptionError";
  }
}

/**
 * Appends an item to a shared list. This is what the dropdown "+" calls, so it
 * has to be safe to hit from a document editor, not just the admin screen.
 */
export async function addOptionItem(
  listId: string,
  input: z.input<typeof optionItemInputSchema>,
  actorId: string,
  tx?: Executor,
): Promise<{ id: string; label: string }> {
  const data = optionItemInputSchema.parse(input);
  const exec = tx ?? db;

  const [existing] = await exec
    .select({ id: optionItems.id, archivedAt: optionItems.archivedAt })
    .from(optionItems)
    .where(and(eq(optionItems.listId, listId), eq(optionItems.label, data.label)))
    .limit(1);

  if (existing) {
    if (!existing.archivedAt) throw new DuplicateOptionError(data.label);
    // Re-adding a label that was archived brings the original item back, so
    // documents still holding its id light up again.
    await exec.update(optionItems).set({ archivedAt: null }).where(eq(optionItems.id, existing.id));
    await writeAudit(
      {
        userId: actorId,
        action: "option.unarchived",
        entity: "option_item",
        entityId: existing.id,
        detail: { listId, label: data.label },
      },
      exec,
    );
    return { id: existing.id, label: data.label };
  }

  const [{ next } = { next: 0 }] = await exec
    .select({ next: sql<number>`coalesce(max(${optionItems.sortOrder}), -1) + 1` })
    .from(optionItems)
    .where(eq(optionItems.listId, listId));

  const [item] = await exec
    .insert(optionItems)
    .values({ listId, label: data.label, sortOrder: next, createdBy: actorId })
    .returning({ id: optionItems.id, label: optionItems.label });
  if (!item) throw new Error("Failed to add option");

  await writeAudit(
    {
      userId: actorId,
      action: "option.add",
      entity: "option_item",
      entityId: item.id,
      detail: { listId, label: item.label },
    },
    exec,
  );

  return item;
}

export async function archiveOptionItem(id: string, actorId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(optionItems)
      .set({ archivedAt: new Date() })
      .where(and(eq(optionItems.id, id), isNull(optionItems.archivedAt)))
      .returning({ id: optionItems.id });
    if (!updated) throw new NotFoundError("Active option");

    await writeAudit(
      { userId: actorId, action: "option.archived", entity: "option_item", entityId: id },
      tx,
    );
  });
}

export async function unarchiveOptionItem(id: string, actorId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(optionItems)
      .set({ archivedAt: null })
      .where(eq(optionItems.id, id))
      .returning({ id: optionItems.id });
    if (!updated) throw new NotFoundError("Option");

    await writeAudit(
      { userId: actorId, action: "option.unarchived", entity: "option_item", entityId: id },
      tx,
    );
  });
}
