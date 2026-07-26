"use client";

import { useState } from "react";

import type { DashboardAttendanceWeekDto } from "@school-kit/types";

// Single-series sparkline: one hue (primary — Deep/Bright Emerald depending
// on theme), 2px rounded line, no axes/gridlines per the mockup's inline
// treatment, hover crosshair per the dataviz skill's "ship a hover layer by
// default" rule even on a compact chart. A single series needs no legend —
// the card title above this component names it.
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

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
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
