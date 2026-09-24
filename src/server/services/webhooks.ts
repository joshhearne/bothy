import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { db, type Executor } from "@/server/db";
import { webhookDeliveries, webhooks } from "@/server/db/schema";
import { writeAudit } from "@/server/services/audit";
import { NotFoundError } from "@/server/services/companies";

/** The event names docs/API.md publishes. */
export const WEBHOOK_EVENTS = [
  "company.created",
  "company.updated",
  "location.created",
  "location.updated",
  "document.created",
  "document.updated",
  "document.archived",
  "field.promoted",
  /** A schedule has reached its lead time, or gone past its date. */
  "document.due",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const MAX_ATTEMPTS = 8;

export const webhookInputSchema = z.object({
  url: z.url({ protocol: /^https?$/, error: "Enter an http or https URL" }).max(2_000),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, "Choose at least one event"),
  active: z.boolean().default(true),
});

export type WebhookRow = {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: Date;
};

export function signPayload(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/** For anyone verifying a signature; exported so tests exercise the real path. */
export function verifySignature(secret: string, body: string, signature: string): boolean {
  const expected = Buffer.from(signPayload(secret, body));
  const presented = Buffer.from(signature);
  return expected.length === presented.length && timingSafeEqual(expected, presented);
}

/** Exponential backoff: 30s, 60s, 120s … capped, over at most 8 attempts. */
export function nextRetryDelayMs(attempts: number): number {
  const base = 30_000 * 2 ** Math.max(0, attempts - 1);
  return Math.min(base, 6 * 60 * 60 * 1000);
}

export async function listWebhooks(): Promise<WebhookRow[]> {
  return db
    .select({
      id: webhooks.id,
      url: webhooks.url,
      events: webhooks.events,
      active: webhooks.active,
      createdAt: webhooks.createdAt,
    })
    .from(webhooks)
    .orderBy(asc(webhooks.createdAt));
}

export async function createWebhook(
  input: z.input<typeof webhookInputSchema>,
  actorId: string,
): Promise<{ row: WebhookRow; secret: string }> {
  const data = webhookInputSchema.parse(input);
  const secret = randomBytes(32).toString("base64url");

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(webhooks)
      .values({ url: data.url, secret, events: data.events, active: data.active })
      .returning({
        id: webhooks.id,
        url: webhooks.url,
        events: webhooks.events,
        active: webhooks.active,
        createdAt: webhooks.createdAt,
      });
    if (!row) throw new Error("Failed to create webhook");

    await writeAudit(
      {
        userId: actorId,
        action: "webhook.created",
        entity: "webhook",
        entityId: row.id,
        detail: { url: data.url, events: data.events },
      },
      tx,
    );

    return { row, secret };
  });
}

export async function setWebhookActive(
  id: string,
  active: boolean,
  actorId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(webhooks)
      .set({ active })
      .where(eq(webhooks.id, id))
      .returning({ id: webhooks.id });
    if (!updated) throw new NotFoundError("Webhook");

    await writeAudit(
      {
        userId: actorId,
        action: active ? "webhook.enabled" : "webhook.disabled",
        entity: "webhook",
        entityId: id,
      },
      tx,
    );
  });
}

export async function deleteWebhook(id: string, actorId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(webhooks).where(eq(webhooks.id, id));
    await writeAudit(
      { userId: actorId, action: "webhook.deleted", entity: "webhook", entityId: id },
      tx,
    );
  });
}

/**
 * Queues one delivery row per subscribed webhook. Called inside the same
 * transaction as the change, so a rolled-back save queues nothing.
 */
export async function queueEvent(
  event: WebhookEvent,
  data: Record<string, unknown>,
  tx?: Executor,
): Promise<void> {
  const exec = tx ?? db;

  const subscribers = await exec
    .select({ id: webhooks.id })
    .from(webhooks)
    .where(and(eq(webhooks.active, true), sql`${event} = ANY(${webhooks.events})`));

  if (subscribers.length === 0) return;

  const payload = { event, occurred_at: new Date().toISOString(), data };
  await exec.insert(webhookDeliveries).values(
    subscribers.map((subscriber) => ({
      webhookId: subscriber.id,
      event,
      payload,
    })),
  );
}

export type DeliveryAttempt = {
  deliveryId: number;
  status: "delivered" | "retrying" | "exhausted";
  statusCode: number | null;
};

/**
 * Sends everything that is due. Called by the in-process worker; exported so a
 * test can drive it directly instead of waiting on a timer.
 */
export async function deliverDueWebhooks(limit = 20): Promise<DeliveryAttempt[]> {
  const now = new Date();

  const due = await db
    .select({
      id: webhookDeliveries.id,
      event: webhookDeliveries.event,
      payload: webhookDeliveries.payload,
      attempts: webhookDeliveries.attempts,
      url: webhooks.url,
      secret: webhooks.secret,
      active: webhooks.active,
    })
    .from(webhookDeliveries)
    .innerJoin(webhooks, eq(webhooks.id, webhookDeliveries.webhookId))
    .where(
      and(
        isNull(webhookDeliveries.deliveredAt),
        lte(webhookDeliveries.attempts, MAX_ATTEMPTS - 1),
        or(
          isNull(webhookDeliveries.nextRetryAt),
          lte(webhookDeliveries.nextRetryAt, now),
        ),
      ),
    )
    .orderBy(asc(webhookDeliveries.id))
    .limit(limit);

  const results: DeliveryAttempt[] = [];

  for (const delivery of due) {
    const attempts = delivery.attempts + 1;

    if (!delivery.active) {
      // Disabled between queueing and sending: stop trying.
      await db
        .update(webhookDeliveries)
        .set({ attempts, nextRetryAt: null, deliveredAt: null, statusCode: null })
        .where(eq(webhookDeliveries.id, delivery.id));
      results.push({ deliveryId: delivery.id, status: "exhausted", statusCode: null });
      continue;
    }

    const body = JSON.stringify(delivery.payload);
    let statusCode: number | null = null;

    try {
      const response = await fetch(delivery.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Bothy-Webhook/1",
          "X-Bothy-Event": delivery.event,
          "X-Bothy-Delivery": String(delivery.id),
          "X-Bothy-Signature": signPayload(delivery.secret, body),
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      statusCode = response.status;
    } catch {
      statusCode = null; // network failure or timeout
    }

    const delivered = statusCode !== null && statusCode >= 200 && statusCode < 300;

    if (delivered) {
      await db
        .update(webhookDeliveries)
        .set({ attempts, statusCode, deliveredAt: new Date(), nextRetryAt: null })
        .where(eq(webhookDeliveries.id, delivery.id));
      results.push({ deliveryId: delivery.id, status: "delivered", statusCode });
      continue;
    }

    const exhausted = attempts >= MAX_ATTEMPTS;
    await db
      .update(webhookDeliveries)
      .set({
        attempts,
        statusCode,
        nextRetryAt: exhausted ? null : new Date(Date.now() + nextRetryDelayMs(attempts)),
      })
      .where(eq(webhookDeliveries.id, delivery.id));

    results.push({
      deliveryId: delivery.id,
      status: exhausted ? "exhausted" : "retrying",
      statusCode,
    });
  }

  return results;
}

export type DeliverySummary = {
  id: number;
  event: string;
  statusCode: number | null;
  attempts: number;
  deliveredAt: Date | null;
  nextRetryAt: Date | null;
  createdAt: Date;
};

export async function listRecentDeliveries(webhookId: string, limit = 20): Promise<DeliverySummary[]> {
  return db
    .select({
      id: webhookDeliveries.id,
      event: webhookDeliveries.event,
      statusCode: webhookDeliveries.statusCode,
      attempts: webhookDeliveries.attempts,
      deliveredAt: webhookDeliveries.deliveredAt,
      nextRetryAt: webhookDeliveries.nextRetryAt,
      createdAt: webhookDeliveries.createdAt,
    })
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.webhookId, webhookId))
    .orderBy(sql`${webhookDeliveries.id} desc`)
    .limit(limit);
}
