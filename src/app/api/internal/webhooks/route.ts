import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { deliverDueWebhooks } from "@/server/services/webhooks";
import { announceDue } from "@/server/services/schedules";
import { runDueDomainChecks } from "@/server/services/domain-checks";

export const dynamic = "force-dynamic";

/**
 * Everything the background worker does, for deployments that cannot hold a
 * timer — a Cloudflare Cron Trigger, or system cron against a container: it
 * announces schedules that have come due, re-runs the domain checks that are
 * due, then delivers what is waiting.
 *
 * The Node container runs both on timers of its own, so this is not needed
 * there; it is also the honest way for a test to watch a pass happen rather
 * than waiting on a clock.
 *
 * Disabled unless CRON_SECRET is set, so it cannot be reached by default.
 */
function authorized(request: Request): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return false;

  const presented = request.headers.get("x-trove-cron-secret") ?? "";
  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request): Promise<Response> {
  if (!env.CRON_SECRET) {
    return Response.json(
      { error: { code: "not_enabled", message: "Set CRON_SECRET to enable this endpoint" } },
      { status: 404 },
    );
  }

  if (!authorized(request)) {
    return Response.json(
      { error: { code: "unauthorized", message: "Wrong or missing cron secret" } },
      { status: 401 },
    );
  }

  // Announce first, so anything that came due this pass goes out in it.
  const announced = await announceDue();
  const domainChecks = await runDueDomainChecks();
  const attempts = await deliverDueWebhooks();

  return Response.json(
    {
      announced,
      domain_checks: domainChecks,
      attempted: attempts.length,
      delivered: attempts.filter((attempt) => attempt.status === "delivered").length,
      retrying: attempts.filter((attempt) => attempt.status === "retrying").length,
      exhausted: attempts.filter((attempt) => attempt.status === "exhausted").length,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
