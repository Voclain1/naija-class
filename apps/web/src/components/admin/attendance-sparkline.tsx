"use client";

import { useState } from "react";

import type { DashboardAttendanceWeekDto } from "@school-kit/types";

import {
  buildSparkline,
  xForWeek,
  DEFAULT_SPARKLINE_SIZE,
} from "./attendance-sparkline.geometry";

type Point = { x: number; y: number };

// Monotone cubic (Hermite) tangents — the Fritsch-Carlson method, same
// algorithm behind D3's curveMonotoneX. Unlike a naive Catmull-Rom spline,
// this never overshoots past a point's local min/max, so a smoothed curve
// through values like [100, 91, 97, 100] can't bulge above 100 or below 91
// between points.
function monotoneTangents(points: Point[]): number[] {
  const n = points.length;
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = points[i + 1]!.x - points[i]!.x;
    d.push(dx === 0 ? 0 : (points[i + 1]!.y - points[i]!.y) / dx);
  }
  const m: number[] = new Array(n).fill(0);
  m[0] = d[0] ?? 0;
  m[n - 1] = d[n - 2] ?? 0;
  for (let i = 1; i < n - 1; i++) {
    m[i] = d[i - 1] === 0 || d[i] === 0 || d[i - 1]! > 0 !== d[i]! > 0 ? 0 : (d[i - 1]! + d[i]!) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i]! / d[i]!;
    const b = m[i + 1]! / d[i]!;
    const s = a * a + b * b;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      m[i] = tau * a * d[i]!;
      m[i + 1] = tau * b * d[i]!;
    }
  }
  return m;
}

// Builds a smoothed SVG path through `points` using cubic Bezier segments
// derived from the monotone tangents above (control points at ±dx/3 along
// each tangent — the standard Hermite-to-Bezier conversion).
function smoothPath(points: Point[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0]!.x} ${points[0]!.y}`;
  const m = monotoneTangents(points);
  let path = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i]!;
    const p1 = points[i + 1]!;
    const dx = (p1.x - p0.x) / 3;
    path += ` C ${p0.x + dx} ${p0.y + m[i]! * dx}, ${p1.x - dx} ${p1.y - m[i + 1]! * dx}, ${p1.x} ${p1.y}`;
  }
  return path;
}

// Single-series sparkline: one hue (primary — Deep/Bright Emerald depending
// on theme), 2px rounded line, no axes/gridlines per the mockup's inline
// treatment, hover crosshair per the dataviz skill's "ship a hover layer by
// default" rule even on a compact chart. A single series needs no legend —
// the card title above this component names it. The line is a monotone
// cubic curve (see smoothPath above), not straight segments — matches the
// editorial feel of the rest of the dashboard instead of reading as a raw
// data-debug plot.
export function AttendanceSparkline({ weeks }: { weeks: DashboardAttendanceWeekDto[] }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const { width, height } = DEFAULT_SPARKLINE_SIZE;

  // Weeks with no register taken are NOT plotted — see the geometry module.
  // The line comes back as contiguous segments so a mid-term break leaves a
  // real gap instead of a straight interpolation through the missing week.
  const { segments, points, gapIndices } = buildSparkline(weeks, DEFAULT_SPARKLINE_SIZE);

  const segmentPaths = segments.map((seg) => smoothPath(seg));
  // The filled area is only meaningful under a single unbroken run; with a
  // gap present it would imply data across the hole, so it is dropped.
  const areaPath =
    segments.length === 1 && segments[0]!.length > 1
      ? `${segmentPaths[0]} L ${segments[0]!.at(-1)!.x} ${height} L ${segments[0]![0]!.x} ${height} Z`
      : null;

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * width;
    // Hit-test against WEEK slots, not plotted points, so hovering an
    // unmarked week still reports that week (as "not marked") rather than
    // snapping to the nearest week that happens to have data.
    let closest = 0;
    let closestDist = Infinity;
    weeks.forEach((_, i) => {
      const dist = Math.abs(xForWeek(i, weeks.length, DEFAULT_SPARKLINE_SIZE) - relX);
      if (dist < closestDist) {
        closestDist = dist;
        closest = i;
      }
    });
    setHoverIndex(closest);
  }

  const hovered = hoverIndex !== null ? weeks[hoverIndex] : null;
  const hoveredPoint = hoverIndex !== null ? (points.find((p) => p.index === hoverIndex) ?? null) : null;
  const hoveredX = hoverIndex !== null ? xForWeek(hoverIndex, weeks.length, DEFAULT_SPARKLINE_SIZE) : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIndex(null)}
      >
        {areaPath && <path d={areaPath} className="fill-primary/10" />}
        {/* Unmarked weeks get a faint tick on the baseline: visible as "no
            register", deliberately not a data point on the curve. */}
        {gapIndices.map((i) => (
          <line
            key={`gap-${i}`}
            x1={xForWeek(i, weeks.length, DEFAULT_SPARKLINE_SIZE)}
            y1={height - 4}
            x2={xForWeek(i, weeks.length, DEFAULT_SPARKLINE_SIZE)}
            y2={height}
            className="stroke-muted-foreground/40"
            strokeWidth={2}
          />
        ))}
        {segmentPaths.map((d, i) => (
          <path
            key={`seg-${i}`}
            d={d}
            className="fill-none stroke-primary"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {hoveredX !== null && (
          <>
            <line
              x1={hoveredX}
              y1={0}
              x2={hoveredX}
              y2={height}
              className="stroke-border"
              strokeWidth={1}
            />
            {hoveredPoint && (
              <circle cx={hoveredPoint.x} cy={hoveredPoint.y} r={4} className="fill-primary" />
            )}
          </>
        )}
      </svg>
      {hovered && hoveredX !== null && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md"
          style={{
            left: `${(hoveredX / width) * 100}%`,
            // An unmarked week has no point to anchor to, so the tooltip sits
            // on the baseline rather than vanishing — the whole fix is that
            // these weeks stay legible instead of silently reading as 0%.
            top: `${((hoveredPoint?.y ?? height) / height) * 100}%`,
          }}
        >
          <div className="font-medium">
            {hovered.percentPresent === null
              ? "No register taken"
              : `${hovered.percentPresent}% present`}
          </div>
          <div className="text-muted-foreground">
            Week of {new Date(hovered.weekStart).toLocaleDateString("en-NG", { month: "short", day: "numeric" })}
          </div>
        </div>
      )}
    </div>
  );
}
