/**
 * When a schedule is asking for attention. Dates here are plain calendar days
 * ("2026-11-14"), not instants: a certificate expires on a date, and which
 * hour it is in the reader's timezone should not change whether it is overdue.
 */

export type ScheduleKind = "expiry" | "maintenance";

export type ScheduleStatus = "ok" | "due_soon" | "overdue";

/** Days from the first date to the second, as whole calendar days. */
export function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return Number.NaN;
  return Math.round((end - start) / 86_400_000);
}

export function today(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function statusOf(
  dueOn: string,
  leadDays: number,
  asOf: string = today(),
): { status: ScheduleStatus; daysRemaining: number } {
  const daysRemaining = daysBetween(asOf, dueOn);
  if (Number.isNaN(daysRemaining)) return { status: "ok", daysRemaining: Number.NaN };

  if (daysRemaining < 0) return { status: "overdue", daysRemaining };
  if (daysRemaining <= leadDays) return { status: "due_soon", daysRemaining };
  return { status: "ok", daysRemaining };
}

/** Whether this schedule is worth putting in front of somebody. */
export function needsAttention(dueOn: string, leadDays: number, asOf: string = today()): boolean {
  return statusOf(dueOn, leadDays, asOf).status !== "ok";
}

export function addDays(date: string, days: number): string {
  const at = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(at)) throw new Error("That is not a date");
  return new Date(at + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The next due date after a maintenance job is done. It steps forward from the
 * date that was due rather than from today, so a job done three days late does
 * not push every future one three days later — but a job done very late does
 * not leave a pile of missed dates in the past either.
 */
export function nextDue(dueOn: string, intervalDays: number, doneOn: string = today()): string {
  if (intervalDays < 1) throw new Error("An interval has to be at least a day");

  let next = addDays(dueOn, intervalDays);
  // Catch up in whole intervals until it is in the future.
  let guard = 0;
  while (daysBetween(doneOn, next) <= 0 && guard < 10_000) {
    next = addDays(next, intervalDays);
    guard += 1;
  }
  return next;
}
