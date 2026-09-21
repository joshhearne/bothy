import "server-only";
import { z } from "zod";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/server/db";
import { docTypes, documents, rackMounts, racks, rackTypeColors } from "@/server/db/schema";
import { writeAudit } from "@/server/services/audit";
import { NotFoundError } from "@/server/services/errors";
import { assertDocumentInScope } from "@/server/services/documents";
import { assertInScope, type CompanyScope } from "@/server/auth/company-scope";
import { normalizeHex } from "@/lib/brand-color";
import { colorWarnings, resolveColors, type ColorWarning, type ResolvedColor } from "@/server/racks/colors";
import type { RackBlock, RackFace } from "@/server/racks/svg";

/**
 * Rack elevations. A rack is an ordinary document with a size, a numbering
 * direction, and a list of what is mounted where; the colours come from the
 * doc type of each mounted thing, which an MSP sets once and a client may
 * override.
 */

export const rackSettingsSchema = z.object({
  totalU: z.coerce.number().int().min(1).max(60),
  hasRear: z.boolean().default(false),
  numbering: z.enum(["bottom_up", "top_down"]).default("bottom_up"),
});

export const mountSchema = z
  .object({
    positionU: z.coerce.number().int().min(1).max(60),
    heightU: z.coerce.number().int().min(1).max(20).default(1),
    face: z.enum(["front", "rear", "both"]).default("front"),
    documentId: z.uuid().optional().nullable(),
    label: z.string().trim().max(200).optional().nullable(),
    docTypeId: z.uuid().optional().nullable(),
  })
  .refine((input) => Boolean(input.documentId) || Boolean(input.label), {
    message: "Choose a document or give it a label",
    path: ["label"],
  });

export type MountInput = z.input<typeof mountSchema>;

export type RackMountView = {
  id: string;
  positionU: number;
  heightU: number;
  face: "front" | "rear" | "both";
  /** What to call it: the document's title, or the label typed instead. */
  name: string;
  documentId: string | null;
  docTypeId: string | null;
  typeName: string | null;
  color: string;
};

export type RackWarning =
  | ColorWarning
  | { kind: "overlap"; face: RackFace; units: string; names: [string, string] }
  | { kind: "out_of_range"; name: string; positionU: number };

export type RackView = {
  documentId: string;
  name: string;
  companyId: string;
  totalU: number;
  hasRear: boolean;
  numbering: "bottom_up" | "top_down";
  mounts: RackMountView[];
  /** One entry per kind of thing in this rack, for the key beside the drawing. */
  legend: ResolvedColor[];
  warnings: RackWarning[];
  /**
   * Changes whenever the drawing would. The elevation is fetched as a file at
   * a fixed URL, so without this a browser keeps showing the rack as it was
   * before the last thing was mounted.
   */
  version: string;
};

/** A short, stable signature of everything the drawing depends on. */
function signatureOf(parts: string[]): string {
  let hash = 0;
  for (const value of parts) {
    for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return hash.toString(36);
}

/** Is this document a rack? Only documents with a rack row have an elevation. */
export async function getRack(documentId: string, scope: CompanyScope) {
  await assertDocumentInScope(documentId, scope);
  const [row] = await db.select().from(racks).where(eq(racks.documentId, documentId)).limit(1);
  return row ?? null;
}

/** The units a mount covers, in rail numbers. */
function unitsOf(mount: { positionU: number; heightU: number }): number[] {
  return Array.from({ length: mount.heightU }, (_, index) => mount.positionU + index);
}

function overlaps(a: RackMountView, b: RackMountView): boolean {
  const sharesFace =
    a.face === "both" || b.face === "both" || a.face === b.face;
  if (!sharesFace) return false;

  const first = new Set(unitsOf(a));
  return unitsOf(b).some((unit) => first.has(unit));
}

export async function getRackView(
  documentId: string,
  scope: CompanyScope,
): Promise<RackView | null> {
  await assertDocumentInScope(documentId, scope);

  const [rack] = await db.select().from(racks).where(eq(racks.documentId, documentId)).limit(1);
  if (!rack) return null;

  const [document] = await db
    .select({ title: documents.title, companyId: documents.companyId })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);
  if (!document) throw new NotFoundError("Document");

  const mountRows = await db
    .select({
      id: rackMounts.id,
      positionU: rackMounts.positionU,
      heightU: rackMounts.heightU,
      face: rackMounts.face,
      documentId: rackMounts.documentId,
      label: rackMounts.label,
      docTypeId: rackMounts.docTypeId,
    })
    .from(rackMounts)
    .where(eq(rackMounts.rackId, documentId))
    .orderBy(asc(rackMounts.positionU));

  // A mounted document supplies both its title and its kind.
  const mountedIds = mountRows
    .map((mount) => mount.documentId)
    .filter((id): id is string => id !== null);

  const mounted = mountedIds.length
    ? await db
        .select({
          id: documents.id,
          title: documents.title,
          docTypeId: documents.docTypeId,
          docTypeName: docTypes.name,
        })
        .from(documents)
        .innerJoin(docTypes, eq(docTypes.id, documents.docTypeId))
        .where(inArray(documents.id, mountedIds))
        .limit(200)
    : [];
  const byDocument = new Map(mounted.map((row) => [row.id, row]));

  // Types named directly by a label-only mount still need their name.
  const namedTypeIds = mountRows
    .map((mount) => mount.docTypeId)
    .filter((id): id is string => id !== null);
  const namedTypes = namedTypeIds.length
    ? await db
        .select({ id: docTypes.id, name: docTypes.name })
        .from(docTypes)
        .where(inArray(docTypes.id, namedTypeIds))
    : [];
  const typeNames = new Map([
    ...namedTypes.map((row) => [row.id, row.name] as const),
    ...mounted.map((row) => [row.docTypeId, row.docTypeName] as const),
  ]);

  const typeIds = [
    ...new Set(
      mountRows
        .map((mount) => byDocument.get(mount.documentId ?? "")?.docTypeId ?? mount.docTypeId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  // The MSP default and this client's override, for every kind in the rack.
  const colorRows = typeIds.length
    ? await db
        .select({
          docTypeId: rackTypeColors.docTypeId,
          companyId: rackTypeColors.companyId,
          color: rackTypeColors.color,
        })
        .from(rackTypeColors)
        .where(
          and(
            inArray(rackTypeColors.docTypeId, typeIds),
            or(isNull(rackTypeColors.companyId), eq(rackTypeColors.companyId, document.companyId)),
          ),
        )
    : [];

  const legend = resolveColors(
    typeIds.map((docTypeId) => ({
      docTypeId,
      docTypeName: typeNames.get(docTypeId) ?? "Other",
      global: colorRows.find((row) => row.docTypeId === docTypeId && row.companyId === null)?.color,
      company: colorRows.find(
        (row) => row.docTypeId === docTypeId && row.companyId === document.companyId,
      )?.color,
    })),
  );
  const colorFor = new Map(legend.map((entry) => [entry.docTypeId, entry.color]));

  const mounts: RackMountView[] = mountRows.map((mount) => {
    const linked = mount.documentId ? byDocument.get(mount.documentId) : undefined;
    const docTypeId = linked?.docTypeId ?? mount.docTypeId ?? null;

    return {
      id: mount.id,
      positionU: mount.positionU,
      heightU: mount.heightU,
      face: mount.face as "front" | "rear" | "both",
      name: linked?.title ?? mount.label ?? "Untitled",
      documentId: mount.documentId,
      docTypeId,
      typeName: docTypeId ? (typeNames.get(docTypeId) ?? null) : null,
      color: (docTypeId ? colorFor.get(docTypeId) : undefined) ?? "#9ca3af",
    };
  });

  const warnings: RackWarning[] = [...colorWarnings(legend)];

  // Two things in the same unit on the same face is a mistake in the data,
  // and the drawing would otherwise show one on top of the other.
  for (let i = 0; i < mounts.length; i += 1) {
    for (let j = i + 1; j < mounts.length; j += 1) {
      const one = mounts[i] as RackMountView;
      const two = mounts[j] as RackMountView;
      if (!overlaps(one, two)) continue;

      const shared = unitsOf(one).filter((unit) => unitsOf(two).includes(unit));
      warnings.push({
        kind: "overlap",
        face: one.face === "rear" || two.face === "rear" ? "rear" : "front",
        units: shared.join(", "),
        names: [one.name, two.name],
      });
    }
  }

  for (const mount of mounts) {
    if (mount.positionU + mount.heightU - 1 > rack.totalU) {
      warnings.push({ kind: "out_of_range", name: mount.name, positionU: mount.positionU });
    }
  }

  return {
    documentId,
    name: document.title,
    companyId: document.companyId,
    totalU: rack.totalU,
    hasRear: rack.hasRear,
    numbering: rack.numbering as "bottom_up" | "top_down",
    mounts,
    legend,
    warnings,
    version: signatureOf([
      document.title,
      String(rack.totalU),
      rack.numbering,
      ...mounts.map(
        (mount) => `${mount.id}:${mount.positionU}:${mount.heightU}:${mount.face}:${mount.name}:${mount.color}`,
      ),
    ]),
  };
}

/** The blocks for one face, which is what the drawing takes. */
export function blocksFor(view: RackView, face: RackFace): RackBlock[] {
  return view.mounts
    .filter((mount) => mount.face === face || mount.face === "both")
    .map((mount) => ({
      positionU: mount.positionU,
      heightU: mount.heightU,
      label: mount.name,
      typeName: mount.typeName,
      color: mount.color,
    }));
}

export async function saveRackSettings(
  documentId: string,
  input: z.input<typeof rackSettingsSchema>,
  actorId: string,
  scope: CompanyScope,
): Promise<void> {
  await assertDocumentInScope(documentId, scope);
  const data = rackSettingsSchema.parse(input);

  await db.transaction(async (tx) => {
    await tx
      .insert(racks)
      .values({ documentId, ...data })
      .onConflictDoUpdate({ target: racks.documentId, set: data });

    await writeAudit(
      {
        userId: actorId,
        action: "rack.updated",
        entity: "document",
        entityId: documentId,
        detail: data,
      },
      tx,
    );
  });
}

export async function addMount(
  documentId: string,
  input: MountInput,
  actorId: string,
  scope: CompanyScope,
): Promise<void> {
  await assertDocumentInScope(documentId, scope);
  const data = mountSchema.parse(input);

  // A mounted document has to be one the caller may see, and in this company.
  if (data.documentId) await assertDocumentInScope(data.documentId, scope);

  await db.transaction(async (tx) => {
    await tx.insert(rackMounts).values({
      rackId: documentId,
      positionU: data.positionU,
      heightU: data.heightU,
      face: data.face,
      documentId: data.documentId ?? null,
      label: data.label ?? null,
      docTypeId: data.docTypeId ?? null,
    });

    await writeAudit(
      {
        userId: actorId,
        action: "rack.mounted",
        entity: "document",
        entityId: documentId,
        detail: { positionU: data.positionU, heightU: data.heightU, face: data.face },
      },
      tx,
    );
  });
}

export async function removeMount(
  mountId: string,
  actorId: string,
  scope: CompanyScope,
): Promise<void> {
  const [mount] = await db
    .select({ rackId: rackMounts.rackId })
    .from(rackMounts)
    .where(eq(rackMounts.id, mountId))
    .limit(1);
  if (!mount) return;

  await assertDocumentInScope(mount.rackId, scope);

  await db.transaction(async (tx) => {
    await tx.delete(rackMounts).where(eq(rackMounts.id, mountId));
    await writeAudit(
      {
        userId: actorId,
        action: "rack.unmounted",
        entity: "document",
        entityId: mount.rackId,
        detail: { mountId },
      },
      tx,
    );
  });
}

/**
 * Sets the colour for a kind of equipment: with no company, the MSP default
 * for everyone; with one, that client's override. An empty colour clears it,
 * which falls back to whatever is above.
 */
export async function setTypeColor(
  docTypeId: string,
  companyId: string | null,
  color: string | null,
  actorId: string,
  scope: CompanyScope,
): Promise<void> {
  if (companyId) assertInScope(scope, companyId);
  const value = color ? normalizeHex(color) : null;

  await db.transaction(async (tx) => {
    await tx
      .delete(rackTypeColors)
      .where(
        and(
          eq(rackTypeColors.docTypeId, docTypeId),
          companyId
            ? eq(rackTypeColors.companyId, companyId)
            : isNull(rackTypeColors.companyId),
        ),
      );

    if (value) {
      await tx.insert(rackTypeColors).values({ docTypeId, companyId, color: value });
    }

    await writeAudit(
      {
        userId: actorId,
        action: "rack.color_set",
        entity: "doc_type",
        entityId: docTypeId,
        detail: { companyId, color: value },
      },
      tx,
    );
  });
}
