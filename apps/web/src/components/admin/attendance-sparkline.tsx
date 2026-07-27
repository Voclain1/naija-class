"use client";

import { useState } from "react";

import type { DashboardAttendanceWeekDto } from "@school-kit/types";

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

  const width = 320;
  const height = 64;
  const padding = 6;
  const values = weeks.map((w) => w.percentPresent);
  const max = Math.max(100, ...values);
  const min = 0;

  const points = values.map((v, i) => {
    const x = padding + (i / Math.max(1, values.length - 1)) * (width - padding * 2);
    const y = height - padding - ((v - min) / (max - min || 1)) * (height - padding * 2);
    return { x, y };
  });

  const linePath = smoothPath(points);
  const areaPath = `${linePath} L ${points[points.length - 1]?.x ?? 0} ${height} L ${points[0]?.x ?? 0} ${height} Z`;

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * width;
    let closest = 0;
    let closestDist = Infinity;
    points.forEach((p, i) => {
      const dist = Math.abs(p.x - relX);
      if (dist < closestDist) {
        closestDist = dist;
        closest = i;
      }
    });
    setHoverIndex(closest);
  }

  const hovered = hoverIndex !== null ? weeks[hoverIndex] : null;
  const hoveredPoint = hoverIndex !== null ? points[hoverIndex] : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIndex(null)}
      >
        <path d={areaPath} className="fill-primary/10" />
        <path
          d={linePath}
          className="fill-none stroke-primary"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {hoveredPoint && (
          <>
            <line
              x1={hoveredPoint.x}
              y1={0}
              x2={hoveredPoint.x}
              y2={height}
              className="stroke-border"
              strokeWidth={1}
            />
            <circle cx={hoveredPoint.x} cy={hoveredPoint.y} r={4} className="fill-primary" />
          </>
        )}
      </svg>
      {hovered && hoveredPoint && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md"
          style={{ left: `${(hoveredPoint.x / width) * 100}%`, top: `${(hoveredPoint.y / height) * 100}%` }}
        >
          <div className="font-medium">{hovered.percentPresent}% present</div>
          <div className="text-muted-foreground">
            Week of {new Date(hovered.weekStart).toLocaleDateString("en-NG", { month: "short", day: "numeric" })}
          </div>
        </div>
      )}
    </div>
  );
}
