import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { canManageIntegrations, requireUser } from "@/server/auth/session";
import { API_SCOPES, listApiKeys } from "@/server/services/api-keys";
import { formatDateTime } from "@/i18n/format";
import { getI18n } from "@/i18n/server";
import { CreateApiKeyForm } from "../integration-forms";
import { revokeApiKeyAction } from "../integration-actions";

export const dynamic = "force-dynamic";

export default async function ApiKeysPage() {
  const user = await requireUser();
  if (!canManageIntegrations(user.role)) redirect("/companies");

  const keys = await listApiKeys();
  const { locale, messages: t } = await getI18n();

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.admin.apiKeys.title}</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          {t.admin.apiKeys.subtitle}
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">{t.admin.apiKeys.existing}</h2>
        {keys.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">{t.admin.apiKeys.empty}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {keys.map((key) => (
              <li key={key.id} className="flex flex-wrap items-center gap-3 rounded-md border px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {key.name}
                    {key.revokedAt && (
                      <span className="ml-2 rounded-full border px-2 py-0.5 text-xs font-normal text-[var(--muted-foreground)]">
                        {t.admin.apiKeys.revoked}
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-[var(--muted-foreground)]">
                    <code>{key.prefix}…</code> · {key.scopes.join(", ")} ·{" "}
                    {key.lastUsedAt
                      ? t.admin.apiKeys.lastUsed(formatDateTime(key.lastUsedAt, locale))
                      : t.admin.apiKeys.neverUsed}
                  </p>
                </div>
                {!key.revokedAt && (
                  <form action={revokeApiKeyAction}>
                    <input type="hidden" name="id" value={key.id} />
                    <Button type="submit" variant="outline" size="sm">
                      {t.admin.apiKeys.revoke}
                    </Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">{t.admin.apiKeys.newKey}</h2>
        <CreateApiKeyForm scopes={[...API_SCOPES]} />
      </section>
    </div>
  );
}
