/**
 * How often each kind of domain check runs, and how far ahead a certificate
 * is worth a warning. Three layers, each able to stay silent: the instance
 * says what everything follows, a company may say otherwise for its own
 * records, and a record may say otherwise for itself. A new record states
 * nothing, so it follows its company, and through it the instance.
 *
 * Pure: resolution and due-ness are decided here and tested here; the
 * service only fetches the three layers and stores what comes back.
 */

export const CHECK_KINDS = ["dns", "tls", "rdap", "email"] as const;

export type CheckKind = (typeof CHECK_KINDS)[number];

/** Days between runs of each kind. Zero is off. */
export type IntervalSet = Record<CheckKind, number>;

/** What a company or a record says, where it says anything. */
export type PolicyOverrides = {
  intervals: Partial<Record<CheckKind, number | null>>;
  tlsWarnDays?: number | null;
};

export type CheckPolicy = {
  intervals: IntervalSet;
  /** Warn when the certificate has fewer days than this left. */
  tlsWarnDays: number;
};

/**
 * DNS and the certificate daily: both are cheap, and a certificate warning
 * is only as current as the last look. Registration and mail posture weekly:
 * they change rarely, and registries rate-limit RDAP.
 */
export const DEFAULT_INTERVALS: IntervalSet = {
  dns: 1,
  tls: 1,
  rdap: 7,
  email: 7,
};

export const DEFAULT_TLS_WARN_DAYS = 30;

/** Domains are renewed on longer notice than certificates; this one is fixed. */
export const REGISTRATION_WARN_DAYS = 60;

export const INTERVAL_MAX_DAYS = 365;

/** The intervals the screens offer. A company or record also offers "default". */
export const INTERVAL_CHOICES = [1, 3, 7, 14, 30, 90] as const;

/** The notice periods the screens offer. */
export const TLS_WARN_CHOICES = [7, 14, 30, 60, 90] as const;

export function isCheckKind(value: unknown): value is CheckKind {
  return (
    typeof value === "string" &&
    (CHECK_KINDS as readonly string[]).includes(value)
  );
}

/** Closest layer that speaks wins, kind by kind. */
export function resolvePolicy(
  instance: CheckPolicy,
  company: PolicyOverrides | null,
  record: PolicyOverrides | null,
): CheckPolicy {
  const intervals = {} as IntervalSet;
  for (const kind of CHECK_KINDS) {
    intervals[kind] =
      record?.intervals[kind] ??
      company?.intervals[kind] ??
      instance.intervals[kind];
  }
  return {
    intervals,
    tlsWarnDays:
      record?.tlsWarnDays ?? company?.tlsWarnDays ?? instance.tlsWarnDays,
  };
}

/**
 * How many days ahead of expiry the certificate is worth a warning, or null
 * for none. A certificate that renews on its own needs no warning; one whose
 * renewal nobody trusts gets the notice the record itself asked for, since
 * that is what asking for one while saying "it renews" means.
 */
export function certificateWarnDays(
  policy: CheckPolicy,
  record: { tlsAutoRenews: boolean; tlsWarnDays: number | null },
): number | null {
  if (record.tlsAutoRenews) return record.tlsWarnDays;
  return policy.tlsWarnDays;
}

export type KindTimes = Partial<Record<CheckKind, Date | null>>;

export type CheckSelection = Record<CheckKind, boolean>;

/** The kinds that are turned on and run at all under this policy. */
export function activeKinds(
  selection: CheckSelection,
  policy: CheckPolicy,
): CheckKind[] {
  return CHECK_KINDS.filter(
    (kind) => selection[kind] && policy.intervals[kind] > 0,
  );
}

/** The active kinds whose time has come, or that have never run. */
export function dueKinds(
  selection: CheckSelection,
  policy: CheckPolicy,
  nextRuns: KindTimes,
  now: Date,
): CheckKind[] {
  return activeKinds(selection, policy).filter((kind) => {
    const at = nextRuns[kind];
    return !at || at.getTime() <= now.getTime();
  });
}

export function nextRunAfter(intervalDays: number, from: Date): Date {
  return new Date(from.getTime() + intervalDays * 86_400_000);
}

/**
 * The next-run time of every kind after a run: the kinds that just ran are
 * scheduled from now, the rest keep their place, and a kind that is off or
 * not chosen has none.
 */
export function scheduleAfterRun(
  selection: CheckSelection,
  policy: CheckPolicy,
  previous: KindTimes,
  ran: readonly CheckKind[],
  now: Date,
): Record<CheckKind, Date | null> {
  const out = {} as Record<CheckKind, Date | null>;
  const active = new Set(activeKinds(selection, policy));
  for (const kind of CHECK_KINDS) {
    if (!active.has(kind)) out[kind] = null;
    else if (ran.includes(kind))
      out[kind] = nextRunAfter(policy.intervals[kind], now);
    else out[kind] = previous[kind] ?? now;
  }
  return out;
}

/** The soonest of the kinds' times: when the worker should look at the record. */
export function soonest(times: KindTimes): Date | null {
  let min: Date | null = null;
  for (const kind of CHECK_KINDS) {
    const at = times[kind];
    if (at && (!min || at.getTime() < min.getTime())) min = at;
  }
  return min;
}

/** A whole number of days in range, or null; what every layer's input goes through. */
export function intervalOrNull(value: unknown, min = 0): number | null {
  const n =
    typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isInteger(n)) return null;
  return n >= min && n <= INTERVAL_MAX_DAYS ? n : null;
}
