import { describe, expect, it } from "vitest";

import type { DashboardAttendanceWeekDto } from "@school-kit/types";

import {
  buildSparkline,
  yForPercent,
  DEFAULT_SPARKLINE_SIZE,
} from "./attendance-sparkline.geometry";

// The defect this proves fixed: an unmarked week (a holiday, a mid-term
// break) used to arrive as percentPresent: 0 and plot on the floor of the
// chart, identical to a week where every student was absent. The DTO now
// sends null plus the totalMarked denominator, and this geometry must drop
// such weeks entirely rather than plotting them.

function week(
  weekStart: string,
  percentPresent: number | null,
  totalMarked: number,
): DashboardAttendanceWeekDto {
  return { weekStart, percentPresent, totalMarked };
}

describe("attendance sparkline geometry", () => {
  it("does not plot a week with no attendance marked", () => {
    const weeks = [
      week("2026-01-05", 94, 120),
      week("2026-01-12", null, 0), // holiday
      week("2026-01-19", 91, 118),
    ];
    const geo = buildSparkline(weeks);

    expect(geo.points.map((p) => p.index)).toEqual([0, 2]);
    expect(geo.gapIndices).toEqual([1]);
  });

  it("never places a point on the floor for an unmarked week (the holiday bug)", () => {
    const weeks = [week("2026-01-05", 94, 120), week("2026-01-12", null, 0)];
    const geo = buildSparkline(weeks);

    // Where a 0% week WOULD have been drawn.
    const floorY = yForPercent(0, 100, DEFAULT_SPARKLINE_SIZE);
    expect(geo.points.some((p) => p.y === floorY)).toBe(false);
    expect(geo.points).toHaveLength(1);
  });

  it("still plots a genuine 0% week on the floor — that one IS data", () => {
    const weeks = [week("2026-01-05", 94, 120), week("2026-01-12", 0, 118)];
    const geo = buildSparkline(weeks);

    const floorY = yForPercent(0, 100, DEFAULT_SPARKLINE_SIZE);
    expect(geo.points).toHaveLength(2);
    expect(geo.points[1]!.y).toBe(floorY);
    expect(geo.gapIndices).toEqual([]);
    // This is the whole point of the fix: a holiday and a total-absence week
    // now render differently.
    const holiday = buildSparkline([week("2026-01-05", 94, 120), week("2026-01-12", null, 0)]);
    expect(holiday.points).toHaveLength(1);
  });

  it("breaks the line into segments around a mid-window gap, never interpolating across it", () => {
    const weeks = [
      week("2026-01-05", 94, 120),
      week("2026-01-12", 92, 119),
      week("2026-01-19", null, 0), // break
      week("2026-01-26", 88, 117),
    ];
    const geo = buildSparkline(weeks);

    expect(geo.segments).toHaveLength(2);
    expect(geo.segments[0]!.map((p) => p.index)).toEqual([0, 1]);
    expect(geo.segments[1]!.map((p) => p.index)).toEqual([3]);
  });

  it("keeps x spacing even across a gap, so weeks stay on the same axis", () => {
    const weeks = [
      week("2026-01-05", 94, 120),
      week("2026-01-12", null, 0),
      week("2026-01-19", 91, 118),
    ];
    const geo = buildSparkline(weeks);
    const [first, last] = geo.points;

    // Index 2 of 3 sits at the right edge; the missing week still occupies
    // its slot rather than the line closing up over it.
    expect(first!.x).toBe(DEFAULT_SPARKLINE_SIZE.padding);
    expect(last!.x).toBe(DEFAULT_SPARKLINE_SIZE.width - DEFAULT_SPARKLINE_SIZE.padding);
  });

  it("handles an all-holiday window without drawing anything", () => {
    const weeks = [week("2026-01-05", null, 0), week("2026-01-12", null, 0)];
    const geo = buildSparkline(weeks);

    expect(geo.points).toHaveLength(0);
    expect(geo.segments).toHaveLength(0);
    expect(geo.gapIndices).toEqual([0, 1]);
  });

  it("fails safe when totalMarked is 0 but percentPresent was left as a number", () => {
    // Defensive: a stale or hand-built payload must not resurrect the bug.
    const geo = buildSparkline([week("2026-01-05", 0, 0)]);
    expect(geo.points).toHaveLength(0);
    expect(geo.gapIndices).toEqual([0]);
  });
});
