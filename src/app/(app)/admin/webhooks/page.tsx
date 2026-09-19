import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { canManageIntegrations, requireUser } from "@/server/auth/session";
import { listRecentDeliveries, listWebhooks, WEBHOOK_EVENTS } from "@/server/services/webhooks";
import { formatDateTime, plural } from "@/i18n/format";
import { getI18n } from "@/i18n/server";
import { CreateWebhookForm } from "../integration-forms";
import { deleteWebhookAction, setWebhookActiveAction } from "../integration-actions";

export const dynamic = "force-dynamic";

export default async function WebhooksPage() {
  const user = await requireUser();
  if (!canManageIntegrations(user.role)) redirect("/companies");

  const hooks = await listWebhooks();
  const deliveries = await Promise.all(
    hooks.map(async (hook) => [hook.id, await listRecentDeliveries(hook.id, 5)] as const),
  );
  const byWebhook = new Map(deliveries);
  const { locale, messages: t } = await getI18n();

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.admin.webhooks.title}</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          {t.admin.webhooks.subtitle}
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">{t.admin.webhooks.endpoints}</h2>
        {hooks.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">{t.admin.webhooks.empty}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {hooks.map((hook) => (
              <li key={hook.id} className="flex flex-col gap-2 rounded-md border px-4 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{hook.url}</p>
                    <p className="text-sm text-[var(--muted-foreground)]">
                      {hook.events.join(", ")}
                    </p>
                  </div>

                  <form action={setWebhookActiveAction}>
                    <input type="hidden" name="id" value={hook.id} />
                    {!hook.active && <input type="hidden" name="active" value="on" />}
                    <Button type="submit" variant="outline" size="sm">
                      {hook.active ? t.admin.webhooks.disable : t.admin.webhooks.enable}
                    </Button>
                  </form>

                  <form action={deleteWebhookAction}>
                    <input type="hidden" name="id" value={hook.id} />
                    <Button type="submit" variant="ghost" size="sm">
                      {t.common.delete}
                    </Button>
                  </form>
                </div>

                {(byWebhook.get(hook.id)?.length ?? 0) > 0 && (
                  <ul className="flex flex-col gap-1 border-t pt-2">
                    {byWebhook.get(hook.id)?.map((delivery) => (
                      <li key={delivery.id} className="text-xs text-[var(--muted-foreground)]">
                        <code>{delivery.event}</code> ·{" "}
                        {delivery.deliveredAt
                          ? t.admin.webhooks.delivered(formatDateTime(delivery.deliveredAt, locale))
                          : delivery.nextRetryAt
                            ? t.admin.webhooks.retrying(
                                formatDateTime(delivery.nextRetryAt, locale),
                              )
                            : t.admin.webhooks.notDelivered}{" "}
                        · {plural(delivery.attempts, t.units.attempt, t.units.attempts, locale)}
                        {delivery.statusCode ? ` · HTTP ${delivery.statusCode}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">{t.admin.webhooks.newWebhook}</h2>
        <CreateWebhookForm events={[...WEBHOOK_EVENTS]} />
      </section>
    </div>
  );
}
