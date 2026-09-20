import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { companies, instanceBranding } from "@/server/db/schema";
import { writeAudit } from "@/server/services/audit";
import { NotFoundError } from "@/server/services/errors";
import { assertInScope, type CompanyScope } from "@/server/auth/company-scope";
import { getStorage } from "@/server/storage";
import { normalizeHex } from "@/lib/brand-color";

/**
 * Branding for the whole instance and for each company: a name, a logo, and one
 * accent color. See docs/BRANDING.md.
 *
 * A logo is stored under a key we generate and served back with the type we
 * sniffed from its own bytes, never the type the browser claimed. SVG is not
 * accepted: an SVG is a document that can carry script, and a logo renders in
 * every signed-in page including the sign-in screen.
 */

export const MAX_LOGO_BYTES = 1024 * 1024;

/** Raster formats every browser draws, identified by their own first bytes. */
const SIGNATURES: { mime: string; extension: string; matches: (bytes: Buffer) => boolean }[] = [
  {
    mime: "image/png",
    extension: "png",
    matches: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mime: "image/jpeg",
    extension: "jpg",
    matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: "image/webp",
    extension: "webp",
    matches: (b) => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP",
  },
];

export const LOGO_ACCEPT = SIGNATURES.map((signature) => signature.mime).join(",");

export class UnsupportedLogoError extends Error {
  constructor() {
    super("A logo must be a PNG, JPEG, or WebP image");
    this.name = "UnsupportedLogoError";
  }
}

export class LogoTooLargeError extends Error {
  constructor() {
    super(`A logo must be smaller than ${Math.round(MAX_LOGO_BYTES / 1024)} KB`);
    this.name = "LogoTooLargeError";
  }
}

/** The type a file actually is, or null. The declared type is not consulted. */
export function sniffImage(bytes: Buffer): { mime: string; extension: string } | null {
  const found = SIGNATURES.find((signature) => signature.matches(bytes));
  return found ? { mime: found.mime, extension: found.extension } : null;
}

export const brandingInputSchema = z.object({
  name: z.string().trim().max(60).optional().nullable(),
  accent: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((value) => (value ? normalizeHex(value) : null))
    .refine((value) => value !== undefined, { message: "Use a hex color like #1f6feb" }),
});

export type BrandingInput = z.input<typeof brandingInputSchema>;

export type Branding = {
  name: string | null;
  accent: string | null;
  /** Ready to put in an img src, with a version so a replaced logo shows up. */
  logoUrl: string | null;
};

/** A key's own uuid doubles as the cache-busting version: a new upload, a new key. */
function version(logoKey: string | null): string {
  return logoKey ? logoKey.split("/").pop()?.split(".")[0]?.slice(0, 12) ?? "1" : "1";
}

export async function getInstanceBranding(): Promise<Branding> {
  const [row] = await db.select().from(instanceBranding).where(eq(instanceBranding.id, true)).limit(1);
  if (!row) return { name: null, accent: null, logoUrl: null };

  return {
    name: row.name,
    accent: row.accent,
    logoUrl: row.logoKey ? `/api/branding/logo?v=${version(row.logoKey)}` : null,
  };
}

export async function setInstanceBranding(input: BrandingInput, actorId: string): Promise<void> {
  const data = brandingInputSchema.parse(input);

  await db.transaction(async (tx) => {
    await tx
      .insert(instanceBranding)
      .values({ id: true, name: data.name || null, accent: data.accent, updatedBy: actorId })
      .onConflictDoUpdate({
        target: instanceBranding.id,
        set: {
          name: data.name || null,
          accent: data.accent,
          updatedAt: new Date(),
          updatedBy: actorId,
        },
      });

    await writeAudit(
      {
        userId: actorId,
        action: "branding.updated",
        entity: "instance",
        entityId: null,
        detail: { name: data.name || null, accent: data.accent },
      },
      tx,
    );
  });
}

async function storeLogo(prefix: string, file: File): Promise<{ key: string; mime: string }> {
  if (file.size === 0 || file.size > MAX_LOGO_BYTES) throw new LogoTooLargeError();

  const bytes = Buffer.from(await file.arrayBuffer());
  const kind = sniffImage(bytes);
  if (!kind) throw new UnsupportedLogoError();

  const key = `branding/${prefix}/${randomUUID()}.${kind.extension}`;
  const storage = await getStorage();
  await storage.put(key, bytes, kind.mime);
  return { key, mime: kind.mime };
}

/** The old object is best effort: a stale blob is better than a broken logo. */
async function forget(key: string | null): Promise<void> {
  if (!key) return;
  try {
    const storage = await getStorage();
    await storage.delete(key);
  } catch {
    // Left for the operator; the row no longer points at it.
  }
}

export async function setInstanceLogo(file: File, actorId: string): Promise<void> {
  const [existing] = await db.select().from(instanceBranding).where(eq(instanceBranding.id, true)).limit(1);
  const stored = await storeLogo("instance", file);

  await db.transaction(async (tx) => {
    await tx
      .insert(instanceBranding)
      .values({ id: true, logoKey: stored.key, logoMime: stored.mime, updatedBy: actorId })
      .onConflictDoUpdate({
        target: instanceBranding.id,
        set: {
          logoKey: stored.key,
          logoMime: stored.mime,
          updatedAt: new Date(),
          updatedBy: actorId,
        },
      });

    await writeAudit(
      { userId: actorId, action: "branding.logo_set", entity: "instance", entityId: null },
      tx,
    );
  });

  await forget(existing?.logoKey ?? null);
}

export async function clearInstanceLogo(actorId: string): Promise<void> {
  const [existing] = await db.select().from(instanceBranding).where(eq(instanceBranding.id, true)).limit(1);
  if (!existing?.logoKey) return;

  await db.transaction(async (tx) => {
    await tx
      .update(instanceBranding)
      .set({ logoKey: null, logoMime: null, updatedAt: new Date(), updatedBy: actorId })
      .where(eq(instanceBranding.id, true));

    await writeAudit(
      { userId: actorId, action: "branding.logo_cleared", entity: "instance", entityId: null },
      tx,
    );
  });

  await forget(existing.logoKey);
}

/** The bytes behind the instance logo, for the route that serves it. */
export async function readInstanceLogo(): Promise<{ body: Buffer; mime: string } | null> {
  const [row] = await db.select().from(instanceBranding).where(eq(instanceBranding.id, true)).limit(1);
  if (!row?.logoKey) return null;

  const storage = await getStorage();
  return { body: await storage.get(row.logoKey), mime: row.logoMime ?? "application/octet-stream" };
}

/* ---------- Per company ---------- */

export async function getCompanyBranding(
  companyId: string,
  scope: CompanyScope,
): Promise<Branding> {
  assertInScope(scope, companyId);

  const [row] = await db
    .select({ accent: companies.accent, logoKey: companies.logoKey })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  if (!row) throw new NotFoundError("Company");

  return {
    name: null,
    accent: row.accent,
    logoUrl: row.logoKey
      ? `/api/companies/${companyId}/logo?v=${version(row.logoKey)}`
      : null,
  };
}

export async function setCompanyAccent(
  companyId: string,
  accent: string | null,
  actorId: string,
  scope: CompanyScope,
): Promise<void> {
  assertInScope(scope, companyId);
  const value = accent ? normalizeHex(accent) : null;

  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(companies)
      .set({ accent: value })
      .where(eq(companies.id, companyId))
      .returning({ id: companies.id });
    if (!row) throw new NotFoundError("Company");

    await writeAudit(
      {
        userId: actorId,
        action: "branding.updated",
        entity: "company",
        entityId: companyId,
        detail: { accent: value },
      },
      tx,
    );
  });
}

export async function setCompanyLogo(
  companyId: string,
  file: File,
  actorId: string,
  scope: CompanyScope,
): Promise<void> {
  assertInScope(scope, companyId);

  const [existing] = await db
    .select({ logoKey: companies.logoKey })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  if (!existing) throw new NotFoundError("Company");

  const stored = await storeLogo(`company/${companyId}`, file);

  await db.transaction(async (tx) => {
    await tx
      .update(companies)
      .set({ logoKey: stored.key, logoMime: stored.mime })
      .where(eq(companies.id, companyId));

    await writeAudit(
      {
        userId: actorId,
        action: "branding.logo_set",
        entity: "company",
        entityId: companyId,
      },
      tx,
    );
  });

  await forget(existing.logoKey);
}

export async function clearCompanyLogo(
  companyId: string,
  actorId: string,
  scope: CompanyScope,
): Promise<void> {
  assertInScope(scope, companyId);

  const [existing] = await db
    .select({ logoKey: companies.logoKey })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  if (!existing?.logoKey) return;

  await db.transaction(async (tx) => {
    await tx
      .update(companies)
      .set({ logoKey: null, logoMime: null })
      .where(eq(companies.id, companyId));

    await writeAudit(
      {
        userId: actorId,
        action: "branding.logo_cleared",
        entity: "company",
        entityId: companyId,
      },
      tx,
    );
  });

  await forget(existing.logoKey);
}

/** The bytes behind a company logo, for the route that serves it. */
export async function readCompanyLogo(
  companyId: string,
  scope: CompanyScope,
): Promise<{ body: Buffer; mime: string } | null> {
  assertInScope(scope, companyId);

  const [row] = await db
    .select({ logoKey: companies.logoKey, logoMime: companies.logoMime })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  if (!row?.logoKey) return null;

  const storage = await getStorage();
  return { body: await storage.get(row.logoKey), mime: row.logoMime ?? "application/octet-stream" };
}
