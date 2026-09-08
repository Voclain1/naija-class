import { describe, expect, it } from "vitest";

import type { RevenueTrajectoryBucketDto } from "@school-kit/types";

import {
  buildSeries,
  futureRegionStartX,
  seriesDomainMax,
  yFor,
  CHART_HEIGHT,
} from "./revenue-trajectory-chart.geometry";

// The rendering guarantee this file exists to prove: a future week never
// becomes a plotted point. The server sends null for "no data yet" and 0 for
// "genuinely nothing collected"; if the chart layer coerces the first into the
// second, the curve dives to the axis and reads as a collections collapse.
// That bug would live here, in the geometry, not in the server aggregate — so
// this is where it gets a test.

function bucket(
  partial: Partial<RevenueTrajectoryBucketDto> & { weekStart: string },
): RevenueTrajectoryBucketDto {
  return {
    kind: "IN_TERM",
    label: "Week",
    invoiced: 0,
    collected: 0,
    isFuture: false,
    ...partial,
  };
}

/** Three known weeks then two future ones — a term in progress. */
const IN_PROGRESS: RevenueTrajectoryBucketDto[] = [
  bucket({ weekStart: "2026-01-05", label: "Week 1", invoiced: 500, collected: 100 }),
  bucket({ weekStart: "2026-01-12", label: "Week 2", invoiced: 500, collected: 250 }),
  bucket({ weekStart: "2026-01-19", label: "Week 3", invoiced: 800, collected: 400 }),
  bucket({ weekStart: "2026-01-26", label: "Week 4", invoiced: null, collected: null, isFuture: true }),
  bucket({ weekStart: "2026-02-02", label: "Week 5", invoiced: null, collected: null, isFuture: true }),
];

describe("revenue trajectory chart geometry", () => {
  it("does not plot future weeks — they produce no point at all", () => {
    const max = seriesDomainMax(IN_PROGRESS);
    const series = buildSeries(IN_PROGRESS, "collected", max);

    expect(series.points).toHaveLength(3);
    expect(series.points.map((p) => p.index)).toEqual([0, 1, 2]);
    expect(series.futureIndices).toEqual([3, 4]);
  });

  it("never emits a zero-valued coordinate for a future week (the collapse bug)", () => {
    const max = seriesDomainMax(IN_PROGRESS);
    const series = buildSeries(IN_PROGRESS, "collected", max);

    // A null coerced to 0 would land exactly on the baseline. Assert no point
    // sits there, and that no point corresponds to a future bucket index.
    const baselineY = yFor(0, max, CHART_HEIGHT);
    expect(series.points.some((p) => p.y === baselineY)).toBe(false);
    for (const p of series.points) {
      expect(IN_PROGRESS[p.index]!.isFuture).toBe(false);
    }
  });

  it("the path ends at the last known week rather than continuing across the gap", () => {
    const max = seriesDomainMax(IN_PROGRESS);
    const series = buildSeries(IN_PROGRESS, "collected", max, { width: 400, height: 100 });

    const commands = series.path.split(" L ").length;
    expect(commands).toBe(3); // M + 2 L, i.e. exactly the three known weeks
    expect(series.path.startsWith("M ")).toBe(true);
    // The last coordinate is week 3's x (index 2 of 5 across width 400 = 200).
    expect(series.path.endsWith("200.00 " + series.points.at(-1)!.y.toFixed(2))).toBe(true);
  });

  it("distinguishes a genuine zero from a future week", () => {
    const zeroWeek: RevenueTrajectoryBucketDto[] = [
      bucket({ weekStart: "2026-01-05", label: "Week 1", invoiced: 500, collected: 0 }),
      bucket({ weekStart: "2026-01-12", label: "Week 2", invoiced: null, collected: null, isFuture: true }),
    ];
    const series = buildSeries(zeroWeek, "collected", seriesDomainMax(zeroWeek));

    // The genuine zero IS plotted — on the baseline, which is the honest
    // reading: nothing has been collected. The future week is not.
    expect(series.points).toHaveLength(1);
    expect(series.points[0]!.value).toBe(0);
    expect(series.futureIndices).toEqual([1]);
  });

  it("shares one y-scale across both series so they stay comparable", () => {
    const max = seriesDomainMax(IN_PROGRESS);
    expect(max).toBe(800); // the invoiced peak, not the collected one

    const invoiced = buildSeries(IN_PROGRESS, "invoiced", max);
    const collected = buildSeries(IN_PROGRESS, "collected", max);
    expect(invoiced.domainMax).toBe(collected.domainMax);
    // Collected is strictly below invoiced everywhere both exist.
    for (let i = 0; i < collected.points.length; i++) {
      expect(collected.points[i]!.y).toBeGreaterThan(invoiced.points[i]!.y);
    }
  });

  it("locates where the not-yet region begins, and reports none when the term is over", () => {
    expect(futureRegionStartX(IN_PROGRESS, 400)).toBe(300); // index 3 of 5

    const finished = IN_PROGRESS.slice(0, 3);
    expect(futureRegionStartX(finished, 400)).toBeNull();
  });

  it("handles an all-future term (not yet started) without drawing anything", () => {
    const notStarted = IN_PROGRESS.map((b) =>
      bucket({ ...b, invoiced: null, collected: null, isFuture: true }),
    );
    const series = buildSeries(notStarted, "collected", seriesDomainMax(notStarted));

    expect(series.points).toHaveLength(0);
    expect(series.path).toBe("");
    expect(series.futureIndices).toHaveLength(5);
    expect(futureRegionStartX(notStarted, 400)).toBe(0);
  });

  it("survives a zero domain without dividing by zero", () => {
    const empty = [bucket({ weekStart: "2026-01-05", invoiced: 0, collected: 0 })];
    const series = buildSeries(empty, "collected", seriesDomainMax(empty));
    expect(series.points[0]!.y).toBe(CHART_HEIGHT);
    expect(Number.isFinite(series.points[0]!.x)).toBe(true);
  });
});
