/**
 * The in-process worker: a timer polling webhook_deliveries, which is what
 * docs/ARCHITECTURE.md asks for instead of a queue service. It also looks for
 * schedules that have come due, far less often, since a date changes once a day.
 */
const INTERVAL_MS = 15_000;
/**
 * A due date changes once a day, so a quarter of an hour is often enough.
 * Configurable because a test wants to see it happen without waiting.
 */
const SCHEDULE_INTERVAL_MS =
  Number(process.env.SCHEDULE_POLL_SECONDS ?? 900) * 1000 || 15 * 60_000;

declare global {
  var __bothyWebhookWorker: NodeJS.Timeout | undefined;
}

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // On Workers a Cron Trigger drives delivery; there is no long-lived process
  // to hold a timer.
  const { isWorkers } = await import("@/lib/runtime");
  if (isWorkers()) return;
  if (process.env.BOTHY_DISABLE_WEBHOOK_WORKER === "true") return;
  if (globalThis.__bothyWebhookWorker) return;

  const { deliverDueWebhooks } = await import("@/server/services/webhooks");
  const { announceDue } = await import("@/server/services/schedules");

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await deliverDueWebhooks();
    } catch (error) {
      console.error("bothy: webhook worker failed", error);
    } finally {
      running = false;
    }
  };

  let announcing = false;
  const announce = async () => {
    if (announcing) return;
    announcing = true;
    try {
      await announceDue();
    } catch (error) {
      console.error("bothy: schedule worker failed", error);
    } finally {
      announcing = false;
    }
  };

  const timer = setInterval(() => void tick(), INTERVAL_MS);
  const scheduleTimer = setInterval(() => void announce(), SCHEDULE_INTERVAL_MS);
  // Never hold the process open just for the pollers.
  timer.unref();
  scheduleTimer.unref();
  globalThis.__bothyWebhookWorker = timer;

  // Once at boot, so a fresh container does not wait a quarter of an hour.
  void announce();

  console.log("bothy: webhook worker started");
}
