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

const hexColor = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((value) => (value ? normalizeHex(value) : null));

export const brandingInputSchema = z.object({
  name: z.string().trim().max(60).optional().nullable(),
  scheme: z.enum(["light", "dark"]).default("light"),
  accent: hexColor,
  altAccent: hexColor,
});

export type BrandingInput = z.input<typeof brandingInputSchema>;

export type BrandScheme = "light" | "dark";

export type Branding = {
  name: string | null;
  /** Which mode the primary logo and accent were drawn for. */
  scheme: BrandScheme;
  accent: string | null;
  /** The exact color for the other mode, when one was given. */
  altAccent: string | null;
  /** Ready to put in an img src, with a version so a replaced logo shows up. */
  logoUrl: string | null;
  /** The logo for the other mode, when one was uploaded. */
  altLogoUrl: string | null;
};

/** Which of the two slots a logo or color belongs to. */
export type BrandSlot = "primary" | "alt";

export function otherScheme(scheme: BrandScheme): BrandScheme {
  return scheme === "light" ? "dark" : "light";
}

/** A key's own uuid doubles as the cache-busting version: a new upload, a new key. */
function version(logoKey: string | null): string {
  return logoKey ? logoKey.split("/").pop()?.split(".")[0]?.slice(0, 12) ?? "1" : "1";
}

export async function getInstanceBranding(): Promise<Branding> {
  const [row] = await db.select().from(instanceBranding).where(eq(instanceBranding.id, true)).limit(1);
  if (!row) {
    return { name: null, scheme: "light", accent: null, altAccent: null, logoUrl: null, altLogoUrl: null };
  }

  return {
    name: row.name,
    scheme: (row.scheme === "dark" ? "dark" : "light") as BrandScheme,
    accent: row.accent,
    altAccent: row.altAccent,
    logoUrl: row.logoKey ? `/api/branding/logo?v=${version(row.logoKey)}` : null,
    altLogoUrl: row.altLogoKey
      ? `/api/branding/logo?variant=alt&v=${version(row.altLogoKey)}`
      : null,
  };
}

export async function setInstanceBranding(input: BrandingInput, actorId: string): Promise<void> {
  const data = brandingInputSchema.parse(input);

  const values = {
    name: data.name || null,
    scheme: data.scheme,
    accent: data.accent,
    altAccent: data.altAccent,
  };

  await db.transaction(async (tx) => {
    await tx
      .insert(instanceBranding)
      .values({ id: true, ...values, updatedBy: actorId })
      .onConflictDoUpdate({
        target: instanceBranding.id,
        set: { ...values, updatedAt: new Date(), updatedBy: actorId },
      });

    await writeAudit(
      {
        userId: actorId,
        action: "branding.updated",
        entity: "instance",
        entityId: null,
        detail: values,
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

export async function setInstanceLogo(
  file: File,
  actorId: string,
  slot: BrandSlot = "primary",
): Promise<void> {
  const [existing] = await db.select().from(instanceBranding).where(eq(instanceBranding.id, true)).limit(1);
  const stored = await storeLogo("instance", file);

  const values =
    slot === "alt"
      ? { altLogoKey: stored.key, altLogoMime: stored.mime }
      : { logoKey: stored.key, logoMime: stored.mime };

  await db.transaction(async (tx) => {
    await tx
      .insert(instanceBranding)
      .values({ id: true, ...values, updatedBy: actorId })
      .onConflictDoUpdate({
        target: instanceBranding.id,
        set: { ...values, updatedAt: new Date(), updatedBy: actorId },
      });

    await writeAudit(
      {
        userId: actorId,
        action: "branding.logo_set",
        entity: "instance",
        entityId: null,
        detail: { slot },
      },
      tx,
    );
  });

  await forget((slot === "alt" ? existing?.altLogoKey : existing?.logoKey) ?? null);
}

export async function clearInstanceLogo(
  actorId: string,
  slot: BrandSlot = "primary",
): Promise<void> {
  const [existing] = await db.select().from(instanceBranding).where(eq(instanceBranding.id, true)).limit(1);
  const key = slot === "alt" ? existing?.altLogoKey : existing?.logoKey;
  if (!key) return;

  const cleared =
    slot === "alt"
      ? { altLogoKey: null, altLogoMime: null }
      : { logoKey: null, logoMime: null };

  await db.transaction(async (tx) => {
    await tx
      .update(instanceBranding)
      .set({ ...cleared, updatedAt: new Date(), updatedBy: actorId })
      .where(eq(instanceBranding.id, true));

    await writeAudit(
      {
        userId: actorId,
        action: "branding.logo_cleared",
        entity: "instance",
        entityId: null,
        detail: { slot },
      },
      tx,
    );
  });

  await forget(key);
}

/** The bytes behind the instance logo, for the route that serves it. */
export async function readInstanceLogo(
  slot: BrandSlot = "primary",
): Promise<{ body: Buffer; mime: string } | null> {
  const [row] = await db.select().from(instanceBranding).where(eq(instanceBranding.id, true)).limit(1);
  const key = slot === "alt" ? row?.altLogoKey : row?.logoKey;
  if (!key) return null;

  const storage = await getStorage();
  const mime = (slot === "alt" ? row?.altLogoMime : row?.logoMime) ?? "application/octet-stream";
  return { body: await storage.get(key), mime };
}

/* ---------- Per company ---------- */

export async function getCompanyBranding(
  companyId: string,
  scope: CompanyScope,
): Promise<Branding> {
  assertInScope(scope, companyId);

  const [row] = await db
    .select({
      scheme: companies.brandScheme,
      accent: companies.accent,
      altAccent: companies.altAccent,
      logoKey: companies.logoKey,
      altLogoKey: companies.altLogoKey,
    })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  if (!row) throw new NotFoundError("Company");

  return {
    name: null,
    scheme: (row.scheme === "dark" ? "dark" : "light") as BrandScheme,
    accent: row.accent,
    altAccent: row.altAccent,
    logoUrl: row.logoKey ? `/api/companies/${companyId}/logo?v=${version(row.logoKey)}` : null,
    altLogoUrl: row.altLogoKey
      ? `/api/companies/${companyId}/logo?variant=alt&v=${version(row.altLogoKey)}`
      : null,
  };
}

export async function setCompanyBranding(
  companyId: string,
  input: { scheme?: string; accent?: string | null; altAccent?: string | null },
  actorId: string,
  scope: CompanyScope,
): Promise<void> {
  assertInScope(scope, companyId);

  const values = {
    brandScheme: input.scheme === "dark" ? "dark" : "light",
    accent: input.accent ? normalizeHex(input.accent) : null,
    altAccent: input.altAccent ? normalizeHex(input.altAccent) : null,
  };

  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(companies)
      .set(values)
      .where(eq(companies.id, companyId))
      .returning({ id: companies.id });
    if (!row) throw new NotFoundError("Company");

    await writeAudit(
      {
        userId: actorId,
        action: "branding.updated",
        entity: "company",
        entityId: companyId,
        detail: values,
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
  slot: BrandSlot = "primary",
): Promise<void> {
  assertInScope(scope, companyId);

  const [existing] = await db
    .select({ logoKey: companies.logoKey, altLogoKey: companies.altLogoKey })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  if (!existing) throw new NotFoundError("Company");

  const stored = await storeLogo(`company/${companyId}`, file);
  const values =
    slot === "alt"
      ? { altLogoKey: stored.key, altLogoMime: stored.mime }
      : { logoKey: stored.key, logoMime: stored.mime };

  await db.transaction(async (tx) => {
    await tx.update(companies).set(values).where(eq(companies.id, companyId));

    await writeAudit(
      {
        userId: actorId,
        action: "branding.logo_set",
        entity: "company",
        entityId: companyId,
        detail: { slot },
      },
      tx,
    );
  });

  await forget((slot === "alt" ? existing.altLogoKey : existing.logoKey) ?? null);
}

export async function clearCompanyLogo(
  companyId: string,
  actorId: string,
  scope: CompanyScope,
  slot: BrandSlot = "primary",
): Promise<void> {
  assertInScope(scope, companyId);

  const [existing] = await db
    .select({ logoKey: companies.logoKey, altLogoKey: companies.altLogoKey })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  const key = slot === "alt" ? existing?.altLogoKey : existing?.logoKey;
  if (!key) return;

  const cleared =
    slot === "alt" ? { altLogoKey: null, altLogoMime: null } : { logoKey: null, logoMime: null };

  await db.transaction(async (tx) => {
    await tx.update(companies).set(cleared).where(eq(companies.id, companyId));

    await writeAudit(
      {
        userId: actorId,
        action: "branding.logo_cleared",
        entity: "company",
        entityId: companyId,
        detail: { slot },
      },
      tx,
    );
  });

  await forget(key);
}

/** The bytes behind a company logo, for the route that serves it. */
export async function readCompanyLogo(
  companyId: string,
  scope: CompanyScope,
  slot: BrandSlot = "primary",
): Promise<{ body: Buffer; mime: string } | null> {
  assertInScope(scope, companyId);

  const [row] = await db
    .select({
      logoKey: companies.logoKey,
      logoMime: companies.logoMime,
      altLogoKey: companies.altLogoKey,
      altLogoMime: companies.altLogoMime,
    })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);

  const key = slot === "alt" ? row?.altLogoKey : row?.logoKey;
  if (!key) return null;

  const storage = await getStorage();
  const mime = (slot === "alt" ? row?.altLogoMime : row?.logoMime) ?? "application/octet-stream";
  return { body: await storage.get(key), mime };
}
