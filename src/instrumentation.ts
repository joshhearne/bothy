/**
 * Webhook retry worker: a timer in this process polling webhook_deliveries,
 * which is what docs/ARCHITECTURE.md asks for instead of a queue service.
 */
const INTERVAL_MS = 15_000;

declare global {
  var __strataWebhookWorker: NodeJS.Timeout | undefined;
}

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.STRATA_DISABLE_WEBHOOK_WORKER === "true") return;
  if (globalThis.__strataWebhookWorker) return;

  const { deliverDueWebhooks } = await import("@/server/services/webhooks");

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await deliverDueWebhooks();
    } catch (error) {
      console.error("strata: webhook worker failed", error);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), INTERVAL_MS);
  // Never hold the process open just for the poller.
  timer.unref();
  globalThis.__strataWebhookWorker = timer;

  console.log("strata: webhook worker started");
}
