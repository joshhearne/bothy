import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { instanceSettings } from "@/server/db/schema";
import { writeAudit } from "@/server/services/audit";
import { isLocale, type Locale } from "@/i18n/locales";

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
