import { describe, expect, it } from "vitest";
import {
  activeKinds,
  certificateWarnDays,
  DEFAULT_INTERVALS,
  DEFAULT_TLS_WARN_DAYS,
  dueKinds,
  intervalOrNull,
  resolvePolicy,
  scheduleAfterRun,
  soonest,
  type CheckPolicy,
} from "./policy";

const instance: CheckPolicy = {
  intervals: DEFAULT_INTERVALS,
  tlsWarnDays: DEFAULT_TLS_WARN_DAYS,
};
const all = { dns: true, tls: true, rdap: true, email: true, brand: true };
const now = new Date("2026-10-08T12:00:00Z");
const day = 86_400_000;

describe("resolvePolicy", () => {
  it("follows the instance when nobody says otherwise", () => {
    expect(resolvePolicy(instance, null, null)).toEqual(instance);
    expect(
      resolvePolicy(instance, { intervals: {} }, { intervals: {} }),
    ).toEqual(instance);
  });

  it("lets a company override kind by kind, and a record override the company", () => {
    const company = { intervals: { dns: 3, rdap: 30 }, tlsWarnDays: 14 };
    const record = { intervals: { dns: 1, email: null }, tlsWarnDays: null };
    expect(resolvePolicy(instance, company, record)).toEqual({
      intervals: { dns: 1, tls: 1, rdap: 30, email: 7, brand: 7 },
      tlsWarnDays: 14,
    });
  });

  it("lets a company turn a kind off for its records with zero", () => {
    expect(
      resolvePolicy(instance, { intervals: { rdap: 0 } }, null).intervals.rdap,
    ).toBe(0);
  });
});

describe("certificateWarnDays", () => {
  it("uses the policy when the certificate does not renew itself", () => {
    expect(
      certificateWarnDays(instance, {
        tlsAutoRenews: false,
        tlsWarnDays: null,
      }),
    ).toBe(30);
  });

  it("is silent for a certificate that renews itself", () => {
    expect(
      certificateWarnDays(instance, { tlsAutoRenews: true, tlsWarnDays: null }),
    ).toBeNull();
  });

  it("warns anyway when the record asks for a notice despite renewal", () => {
    expect(
      certificateWarnDays(instance, { tlsAutoRenews: true, tlsWarnDays: 14 }),
    ).toBe(14);
  });
});

describe("activeKinds and dueKinds", () => {
  it("skips kinds that are off or not chosen", () => {
    const policy = resolvePolicy(instance, { intervals: { rdap: 0 } }, null);
    expect(activeKinds({ ...all, email: false, brand: false }, policy)).toEqual([
      "dns",
      "tls",
    ]);
  });

  it("treats never-run and overdue as due, and future as not", () => {
    const due = dueKinds(
      all,
      instance,
      {
        dns: new Date(now.getTime() - 1),
        tls: new Date(now.getTime() + day),
        rdap: null,
      },
      now,
    );
    expect(due).toEqual(["dns", "rdap", "email", "brand"]);
  });
});

describe("scheduleAfterRun", () => {
  it("reschedules what ran, keeps what did not, clears what is off", () => {
    const policy = resolvePolicy(instance, null, { intervals: { email: 0 } });
    const kept = new Date(now.getTime() + 3 * day);
    const next = scheduleAfterRun(
      all,
      policy,
      { rdap: kept, email: kept },
      ["dns", "tls"],
      now,
    );
    expect(next.dns).toEqual(new Date(now.getTime() + day));
    expect(next.tls).toEqual(new Date(now.getTime() + day));
    expect(next.rdap).toEqual(kept);
    expect(next.email).toBeNull();
  });

  it("gives a kind that is active but never scheduled a time of now", () => {
    const next = scheduleAfterRun(all, instance, {}, ["dns"], now);
    expect(next.rdap).toEqual(now);
  });
});

describe("soonest", () => {
  it("is the earliest time, ignoring nulls, and null when there is none", () => {
    const a = new Date(now.getTime() + day);
    const b = new Date(now.getTime() + 2 * day);
    expect(soonest({ dns: b, tls: a, rdap: null })).toEqual(a);
    expect(soonest({ dns: null })).toBeNull();
  });
});

describe("intervalOrNull", () => {
  it("accepts whole days in range from a form string or a number", () => {
    expect(intervalOrNull("7")).toBe(7);
    expect(intervalOrNull(0)).toBe(0);
    expect(intervalOrNull(0, 1)).toBeNull();
    expect(intervalOrNull("")).toBeNull();
    expect(intervalOrNull("366")).toBeNull();
    expect(intervalOrNull("1.5")).toBeNull();
    expect(intervalOrNull(undefined)).toBeNull();
  });
});
