import type { RevenueTrajectoryBucketDto } from "@school-kit/types";

// Pure geometry for the revenue trajectory chart.
//
// Extracted out of the component deliberately, following the precedent
// apps/web/vitest.config.ts sets: DOM/component tests are not configured in
// this app, so anything that must be provable lives here as pure logic with a
// sibling .spec.ts, and rendered behaviour is left to Playwright.
//
// The rule this file exists to enforce: a future week (invoiced/collected ===
// null) is NOT a data point. It must never become a coordinate, because a
// null coerced to 0 plots on the axis and draws a cliff to the bottom of the
// chart — which reads as a total collections collapse when the truth is that
// the week has not happened yet. "No data yet" and "zero collected" are
// different facts and the chart has to keep them different.

export const CHART_WIDTH = 640;
export const CHART_HEIGHT = 220;

export type SeriesKey = "invoiced" | "collected";

export interface ChartPoint {
  /** Index into the bucket array — x position is derived from this. */
  index: number;
  x: number;
  y: number;
  value: number;
}

export interface ChartGeometry {
  points: ChartPoint[];
  path: string;
  /** Buckets that carry no data yet, for rendering the "not yet" region. */
  futureIndices: number[];
  /** Highest value across BOTH series, so they share one y-scale. */
  domainMax: number;
}

/**
 * Highest value across both series. Shared so the two curves are directly
 * comparable — separately-scaled lines would make a 40%-collected term look
 * fully collected.
 */
export function seriesDomainMax(buckets: RevenueTrajectoryBucketDto[]): number {
  let max = 0;
  for (const b of buckets) {
    if (b.invoiced !== null && b.invoiced > max) max = b.invoiced;
    if (b.collected !== null && b.collected > max) max = b.collected;
  }
  return max;
}

export function xFor(index: number, count: number, width = CHART_WIDTH): number {
  if (count <= 1) return 0;
  return (index / (count - 1)) * width;
}

export function yFor(value: number, domainMax: number, height = CHART_HEIGHT): number {
  if (domainMax <= 0) return height;
  return height - (value / domainMax) * height;
}

/**
 * Builds the points and SVG path for one series.
 *
 * Buckets whose value is `null` are SKIPPED — they produce no point and the
 * path simply ends. They are reported separately in `futureIndices` so the
 * component can shade that region and label it, rather than drawing a line
 * through it.
 */
export function buildSeries(
  buckets: RevenueTrajectoryBucketDto[],
  key: SeriesKey,
  domainMax: number,
  size: { width?: number; height?: number } = {},
): ChartGeometry {
  const width = size.width ?? CHART_WIDTH;
  const height = size.height ?? CHART_HEIGHT;

  const points: ChartPoint[] = [];
  const futureIndices: number[] = [];

  buckets.forEach((b, index) => {
    const value = b[key];
    if (value === null) {
      futureIndices.push(index);
      return;
    }
    points.push({
      index,
      x: xFor(index, buckets.length, width),
      y: yFor(value, domainMax, height),
      value,
    });
  });

  const path = points.length
    ? points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ")
    : "";

  return { points, path, futureIndices, domainMax };
}

/**
 * Where the "not yet" region begins, as an x coordinate — or null when the
 * term has no future weeks. Used to shade the remaining runway.
 */
export function futureRegionStartX(
  buckets: RevenueTrajectoryBucketDto[],
  width = CHART_WIDTH,
): number | null {
  const first = buckets.findIndex((b) => b.isFuture);
  if (first < 0) return null;
  return xFor(first, buckets.length, width);
}
