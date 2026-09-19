import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { canManageIntegrations, requireUser } from "@/server/auth/session";
import { listRecentDeliveries, listWebhooks, WEBHOOK_EVENTS } from "@/server/services/webhooks";
import { formatDateTime } from "@/server/fields/render";
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

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Webhooks</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          Signed with HMAC-SHA256, retried with backoff up to 8 attempts.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Endpoints</h2>
        {hooks.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">No webhooks yet.</p>
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
                      {hook.active ? "Disable" : "Enable"}
                    </Button>
                  </form>

                  <form action={deleteWebhookAction}>
                    <input type="hidden" name="id" value={hook.id} />
                    <Button type="submit" variant="ghost" size="sm">
                      Delete
                    </Button>
                  </form>
                </div>

                {(byWebhook.get(hook.id)?.length ?? 0) > 0 && (
                  <ul className="flex flex-col gap-1 border-t pt-2">
                    {byWebhook.get(hook.id)?.map((delivery) => (
                      <li key={delivery.id} className="text-xs text-[var(--muted-foreground)]">
                        <code>{delivery.event}</code> ·{" "}
                        {delivery.deliveredAt
                          ? `delivered ${formatDateTime(delivery.deliveredAt)}`
                          : delivery.nextRetryAt
                            ? `retrying after ${formatDateTime(delivery.nextRetryAt)}`
                            : "not delivered"}{" "}
                        · {delivery.attempts} attempt{delivery.attempts === 1 ? "" : "s"}
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
        <h2 className="text-lg font-semibold tracking-tight">New webhook</h2>
        <CreateWebhookForm events={[...WEBHOOK_EVENTS]} />
      </section>
    </div>
  );
}
