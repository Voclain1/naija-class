import type { DashboardAttendanceWeekDto } from "@school-kit/types";

// Pure geometry for the attendance sparkline.
//
// Extracted so the no-data handling is unit-testable: apps/web has no DOM test
// setup by deliberate choice (see vitest.config.ts), so anything that must be
// provable lives in a pure module with a sibling .spec.ts.
//
// The rule this enforces: a week with no attendance records is NOT a data
// point. `percentPresent` is null for such a week, and a null must never
// become a y coordinate — coerced to 0 it plots on the floor of the chart and
// is indistinguishable from a week in which every student was absent. A
// holiday and a catastrophe are different facts.
//
// Because a gap can fall in the MIDDLE of the window (a mid-term break with
// marked weeks either side), the line is returned as a list of contiguous
// segments rather than one path. Drawing one path across a gap would
// interpolate straight through the missing week and invent a reading for it.

export interface SparklinePoint {
  index: number;
  x: number;
  y: number;
  percentPresent: number;
}

export interface SparklineGeometry {
  /** Contiguous runs of marked weeks. Each renders as its own path. */
  segments: SparklinePoint[][];
  /** Every plotted point, flattened — for hover hit-testing and dots. */
  points: SparklinePoint[];
  /** Indices of weeks with no attendance marked at all. */
  gapIndices: number[];
}

export interface SparklineSize {
  width: number;
  height: number;
  padding: number;
}

export const DEFAULT_SPARKLINE_SIZE: SparklineSize = { width: 320, height: 64, padding: 6 };

/** x for a week index — spacing stays even whether or not the week has data. */
export function xForWeek(index: number, count: number, size: SparklineSize): number {
  const span = size.width - size.padding * 2;
  return size.padding + (index / Math.max(1, count - 1)) * span;
}

export function yForPercent(percent: number, max: number, size: SparklineSize): number {
  const span = size.height - size.padding * 2;
  return size.height - size.padding - (percent / (max || 1)) * span;
}

export function buildSparkline(
  weeks: DashboardAttendanceWeekDto[],
  size: SparklineSize = DEFAULT_SPARKLINE_SIZE,
): SparklineGeometry {
  const known = weeks
    .map((w) => w.percentPresent)
    .filter((v): v is number => v !== null);
  const max = Math.max(100, ...known);

  const segments: SparklinePoint[][] = [];
  const points: SparklinePoint[] = [];
  const gapIndices: number[] = [];
  let current: SparklinePoint[] = [];

  weeks.forEach((w, index) => {
    // totalMarked is the authority; percentPresent being null is its
    // consequence. Both are checked so a stale payload missing one of them
    // still fails safe (no point) rather than plotting a zero.
    if (w.percentPresent === null || w.totalMarked === 0) {
      gapIndices.push(index);
      if (current.length) {
        segments.push(current);
        current = [];
      }
      return;
    }
    const p: SparklinePoint = {
      index,
      x: xForWeek(index, weeks.length, size),
      y: yForPercent(w.percentPresent, max, size),
      percentPresent: w.percentPresent,
    };
    current.push(p);
    points.push(p);
  });

  if (current.length) segments.push(current);

  return { segments, points, gapIndices };
}
