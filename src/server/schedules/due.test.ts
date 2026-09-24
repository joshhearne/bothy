import { describe, expect, it } from "vitest";
import { addDays, daysBetween, needsAttention, nextDue, statusOf, today } from "./due";

describe("daysBetween", () => {
  it("counts whole calendar days", () => {
    expect(daysBetween("2026-09-24", "2026-09-25")).toBe(1);
    expect(daysBetween("2026-09-25", "2026-09-24")).toBe(-1);
    expect(daysBetween("2026-09-24", "2026-09-24")).toBe(0);
  });

  it("crosses a month, a year, and a leap day without drifting", () => {
    expect(daysBetween("2026-01-31", "2026-02-01")).toBe(1);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2);
  });

  it("is NaN for something that is not a date", () => {
    expect(daysBetween("soon", "2026-09-24")).toBeNaN();
  });
});

describe("statusOf", () => {
  const asOf = "2026-09-24";

  it("is quiet while the date is far off", () => {
    expect(statusOf("2026-12-31", 30, asOf)).toEqual({ status: "ok", daysRemaining: 98 });
  });

  it("speaks up once inside the lead time, including the day it lands", () => {
    expect(statusOf("2026-10-20", 30, asOf).status).toBe("due_soon");
    expect(statusOf("2026-10-24", 30, asOf).status).toBe("due_soon");
    expect(statusOf(asOf, 30, asOf)).toEqual({ status: "due_soon", daysRemaining: 0 });
  });

  it("is overdue the day after", () => {
    expect(statusOf("2026-09-23", 30, asOf)).toEqual({ status: "overdue", daysRemaining: -1 });
  });

  it("respects a lead time of none", () => {
    expect(statusOf("2026-09-25", 0, asOf).status).toBe("ok");
    expect(statusOf(asOf, 0, asOf).status).toBe("due_soon");
  });
});

describe("needsAttention", () => {
  it("is true for anything not still quiet", () => {
    expect(needsAttention("2026-12-31", 30, "2026-09-24")).toBe(false);
    expect(needsAttention("2026-10-01", 30, "2026-09-24")).toBe(true);
    expect(needsAttention("2026-09-01", 30, "2026-09-24")).toBe(true);
  });
});

describe("nextDue", () => {
  it("steps from the date that was due, not from the day it was done", () => {
    // Due on the 1st, done three days late: the next one is still on the 1st.
    expect(nextDue("2026-09-01", 30, "2026-09-04")).toBe("2026-10-01");
  });

  it("catches up in whole intervals when something was missed for months", () => {
    const next = nextDue("2026-01-01", 30, "2026-09-24");
    expect(daysBetween("2026-09-24", next)).toBeGreaterThan(0);
    // Still on the original cadence: a whole number of intervals on.
    expect(daysBetween("2026-01-01", next) % 30).toBe(0);
  });

  it("always lands in the future", () => {
    for (const interval of [1, 7, 30, 90, 365]) {
      const next = nextDue("2020-01-01", interval, "2026-09-24");
      expect(daysBetween("2026-09-24", next)).toBeGreaterThan(0);
    }
  });

  it("refuses an interval that is not one", () => {
    expect(() => nextDue("2026-09-01", 0)).toThrow();
  });
});

describe("addDays and today", () => {
  it("moves forward and back", () => {
    expect(addDays("2026-09-24", 7)).toBe("2026-10-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("reads a date, not an instant", () => {
    expect(today(new Date("2026-09-24T23:30:00Z"))).toBe("2026-09-24");
  });
});
