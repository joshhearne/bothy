import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { instanceSettings } from "@/server/db/schema";
import { writeAudit } from "@/server/services/audit";
import { z } from "zod";
import { isLocale, type Locale } from "@/i18n/locales";
import { parseAddressList } from "@/server/kb/addresses";

/**
 * Settings an operator chooses once for the whole installation. Today that is
 * the default language a new reader gets; the environment still supplies it
 * when nobody has chosen, so an install that never opens this screen behaves
 * exactly as it did.
 */

export async function getDefaultLocale(): Promise<Locale | null> {
  const [row] = await db
    .select({ defaultLocale: instanceSettings.defaultLocale })
    .from(instanceSettings)
    .where(eq(instanceSettings.id, true))
    .limit(1);

  return isLocale(row?.defaultLocale) ? row.defaultLocale : null;
}

export async function setDefaultLocale(locale: string | null, actorId: string): Promise<void> {
  const value = isLocale(locale) ? locale : null;

  await db.transaction(async (tx) => {
    await tx
      .insert(instanceSettings)
      .values({ id: true, defaultLocale: value, updatedBy: actorId })
      .onConflictDoUpdate({
        target: instanceSettings.id,
        set: { defaultLocale: value, updatedAt: new Date(), updatedBy: actorId },
      });

    await writeAudit(
      {
        userId: actorId,
        action: "settings.updated",
        entity: "instance",
        entityId: null,
        detail: { defaultLocale: value },
      },
      tx,
    );
  });
}

/* ---------- Public knowledge base ---------- */

export const KB_PUBLIC_MODES = ["off", "addresses", "open"] as const;
export type KbPublicMode = (typeof KB_PUBLIC_MODES)[number];

export type KbPublicSettings = {
  mode: KbPublicMode;
  /** As typed, for the form. */
  addressText: string;
  /** What of it can be used. */
  addresses: string[];
  url: string | null;
  /** Cloudflare Access in front of the site, when both are set. */
  accessTeam: string | null;
  accessAud: string | null;
};

export const kbPublicInputSchema = z
  .object({
    mode: z.enum(KB_PUBLIC_MODES),
    addresses: z.string().max(10_000).default(""),
    url: z
      .string()
      .trim()
      .max(500)
      .refine((value) => {
        if (value === "") return true;
        try {
          const url = new URL(value);
          return url.protocol === "https:" || url.protocol === "http:";
        } catch {
          return false;
        }
      }, "Enter an http or https address")
      .default(""),
    /** The team's domain as Cloudflare names it: "example" for example.cloudflareaccess.com. */
    accessTeam: z
      .string()
      .trim()
      .toLowerCase()
      .max(100)
      .regex(/^[a-z0-9-]*$/, "The team name is the part before .cloudflareaccess.com")
      .default(""),
    accessAud: z
      .string()
      .trim()
      .max(200)
      .regex(/^[a-f0-9]*$/i, "The audience tag is hexadecimal")
      .default(""),
  })
  .superRefine((input, ctx) => {
    if ((input.accessTeam === "") !== (input.accessAud === "")) {
      ctx.addIssue({
        code: "custom",
        path: [input.accessTeam === "" ? "accessTeam" : "accessAud"],
        message: "Set both the team and the audience tag, or neither",
      });
    }
    const list = parseAddressList(input.addresses);
    if (list.rejected.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["addresses"],
        message: `Not an address or a range: ${list.rejected.slice(0, 5).join(", ")}`,
      });
    }
    // Saying "these addresses" and naming none would be "off" by accident.
    if (input.mode === "addresses" && list.entries.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["addresses"],
        message: "List at least one address or range",
      });
    }
  });

export async function getKbPublicSettings(): Promise<KbPublicSettings> {
  const [row] = await db
    .select({
      mode: instanceSettings.kbPublicMode,
      addresses: instanceSettings.kbPublicAddresses,
      url: instanceSettings.kbPublicUrl,
      accessTeam: instanceSettings.kbPublicAccessTeam,
      accessAud: instanceSettings.kbPublicAccessAud,
    })
    .from(instanceSettings)
    .where(eq(instanceSettings.id, true))
    .limit(1);

  const mode = (KB_PUBLIC_MODES as readonly string[]).includes(row?.mode ?? "")
    ? (row?.mode as KbPublicMode)
    : "off";

  return {
    mode,
    addressText: row?.addresses ?? "",
    addresses: parseAddressList(row?.addresses ?? "").entries,
    url: row?.url ?? null,
    accessTeam: row?.accessTeam ?? null,
    accessAud: row?.accessAud ?? null,
  };
}

export async function setKbPublicSettings(
  input: z.input<typeof kbPublicInputSchema>,
  actorId: string,
): Promise<void> {
  const data = kbPublicInputSchema.parse(input);
  const values = {
    kbPublicMode: data.mode,
    kbPublicAddresses: data.addresses.trim(),
    kbPublicUrl: data.url === "" ? null : data.url.replace(/\/+$/, ""),
    kbPublicAccessTeam: data.accessTeam === "" ? null : data.accessTeam,
    kbPublicAccessAud: data.accessAud === "" ? null : data.accessAud,
  };

  await db.transaction(async (tx) => {
    await tx
      .insert(instanceSettings)
      .values({ id: true, ...values, updatedBy: actorId })
      .onConflictDoUpdate({
        target: instanceSettings.id,
        set: { ...values, updatedAt: new Date(), updatedBy: actorId },
      });

    await writeAudit(
      {
        userId: actorId,
        action: "settings.updated",
        entity: "instance",
        entityId: null,
        detail: {
          kbPublicMode: values.kbPublicMode,
          kbPublicAddresses: parseAddressList(values.kbPublicAddresses).entries,
          kbPublicUrl: values.kbPublicUrl,
          kbPublicAccessTeam: values.kbPublicAccessTeam,
        },
      },
      tx,
    );
  });
}
