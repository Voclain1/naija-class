import { describe, expect, it } from "vitest";

import type { RevenueTrajectoryBucketDto, RevenueTrajectoryDto } from "@school-kit/types";

import { resolveBillingWindow } from "./billing-window";

// The billing-window line on the finance dashboard's collection-rate card.
//
// The edge cases here are the whole point: the mockup showed a hard-coded
// "Week 3 of 13", and the three real states (not started / in progress /
// ended) are the ones a hard-coded string gets wrong.

function bucket(
  label: string,
  kind: RevenueTrajectoryBucketDto["kind"],
  isFuture: boolean,
): RevenueTrajectoryBucketDto {
  return { weekStart: "2026-01-05", kind, label, invoiced: isFuture ? null : 0, collected: isFuture ? null : 0, isFuture };
}

function trajectory(buckets: RevenueTrajectoryBucketDto[]): RevenueTrajectoryDto {
  return {
    termId: "t1",
    termName: "Second Term",
    termStartDate: "2026-01-05",
    termEndDate: "2026-04-03",
    asOf: "2026-02-01T00:00:00.000Z",
    buckets,
    totalInvoiced: 0,
    totalCollected: 0,
  };
}

const weeks = (total: number, arrived: number) =>
  Array.from({ length: total }, (_, i) => bucket(`Week ${i + 1}`, "IN_TERM", i >= arrived));

describe("resolveBillingWindow", () => {
  it("counts the weeks that have actually arrived", () => {
    expect(resolveBillingWindow(trajectory(weeks(13, 3)))?.label).toBe("Billing window: Week 3 of 13");
  });

  it("does not claim billing has begun before the term starts", () => {
    // Every week still in the future. "Week 1 of 13" would state that the
    // first billing week is underway when it has not arrived.
    const w = resolveBillingWindow(trajectory(weeks(13, 0)));
    expect(w?.currentWeek).toBe(0);
    expect(w?.label).toBe("Term has not started — 13 weeks");
    expect(w?.label).not.toContain("Week 1");
  });

  it("reads as complete once every week has arrived", () => {
    const w = resolveBillingWindow(trajectory(weeks(13, 13)));
    expect(w?.label).toBe("Billing window: Week 13 of 13");
    expect(w?.currentWeek).toBe(w?.totalWeeks);
  });

  it("never counts a week past the end of the term", () => {
    // The guard against an off-by-one that would render "Week 14 of 13".
    const w = resolveBillingWindow(trajectory(weeks(13, 13)))!;
    expect(w.currentWeek).toBeLessThanOrEqual(w.totalWeeks);
  });

  it("ignores the out-of-term buckets entirely", () => {
    // BEFORE_TERM / AFTER_TERM exist so the curve reconciles with the KPI
    // totals. They are not billing weeks and must not inflate the count.
    const w = resolveBillingWindow(
      trajectory([
        bucket("Before term", "BEFORE_TERM", false),
        ...weeks(10, 4),
        bucket("After term", "AFTER_TERM", false),
      ]),
    );
    expect(w?.totalWeeks).toBe(10);
    expect(w?.currentWeek).toBe(4);
  });

  it("returns null when there is nothing truthful to say", () => {
    // A term with no in-term weeks is a setup problem; "Week 0 of 0" states
    // it in the least useful possible way.
    expect(resolveBillingWindow(trajectory([]))).toBeNull();
    expect(resolveBillingWindow(trajectory([bucket("Before term", "BEFORE_TERM", false)]))).toBeNull();
    expect(resolveBillingWindow(null)).toBeNull();
    expect(resolveBillingWindow(undefined)).toBeNull();
  });
});
