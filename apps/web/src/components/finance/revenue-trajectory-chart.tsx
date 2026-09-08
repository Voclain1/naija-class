"use client";

import { useState } from "react";

import type { RevenueTrajectoryDto } from "@school-kit/types";

import { formatKobo } from "@/lib/finance/format";
import {
  buildSeries,
  futureRegionStartX,
  seriesDomainMax,
  xFor,
  CHART_HEIGHT,
  CHART_WIDTH,
} from "./revenue-trajectory-chart.geometry";

// Two cumulative curves — invoiced vs collected — across the term's own weeks.
//
// Hand-rolled SVG, matching every other chart in this app (there is no
// charting library in the repo; attendance-sparkline.tsx is the precedent).
// All geometry lives in the sibling .geometry.ts so it can be unit-tested —
// component/DOM tests are not configured in apps/web by deliberate choice.
//
// The one behaviour worth stating plainly: weeks that have not happened yet
// are NOT drawn. The server sends null for them (distinct from 0), the
// geometry skips them, and the region is shaded and labelled "not yet" so the
// remaining runway is visible without pretending it is a zero reading.

export function RevenueTrajectoryChart({ data }: { data: RevenueTrajectoryDto }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const buckets = data.buckets;
  const domainMax = seriesDomainMax(buckets);
  const invoiced = buildSeries(buckets, "invoiced", domainMax);
  const collected = buildSeries(buckets, "collected", domainMax);
  const futureX = futureRegionStartX(buckets);

  const hovered = hoverIndex !== null ? buckets[hoverIndex] : null;

  if (buckets.length === 0) {
    return <p className="text-sm text-muted-foreground">No weeks to show for this term.</p>;
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded bg-primary" aria-hidden />
          Invoiced
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded bg-secondary" aria-hidden />
          Collected
        </span>
        {futureX !== null && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-4 rounded bg-muted" aria-hidden />
            Not yet — no data
          </span>
        )}
      </div>

      <div className="relative overflow-x-auto">
        <svg
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          className="h-48 w-full min-w-[320px]"
          role="img"
          aria-label={`Revenue trajectory for ${data.termName}: invoiced and collected, cumulative, by week`}
          onMouseLeave={() => setHoverIndex(null)}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = (e.clientX - rect.left) / rect.width;
            const idx = Math.round(ratio * (buckets.length - 1));
            setHoverIndex(Math.min(buckets.length - 1, Math.max(0, idx)));
          }}
        >
          {/* The "not yet" region — shaded rather than plotted, so the term's
              remaining runway is visible without implying a zero reading. */}
          {futureX !== null && (
            <rect
              x={futureX}
              y={0}
              width={CHART_WIDTH - futureX}
              height={CHART_HEIGHT}
              className="fill-muted/50"
            />
          )}

          <line
            x1={0}
            y1={CHART_HEIGHT}
            x2={CHART_WIDTH}
            y2={CHART_HEIGHT}
            className="stroke-border"
            strokeWidth={1}
          />

          {invoiced.path && (
            <path d={invoiced.path} className="fill-none stroke-primary" strokeWidth={2} />
          )}
          {collected.path && (
            <path d={collected.path} className="fill-none stroke-secondary" strokeWidth={2} />
          )}

          {hovered && (
            <line
              x1={xFor(hoverIndex!, buckets.length)}
              y1={0}
              x2={xFor(hoverIndex!, buckets.length)}
              y2={CHART_HEIGHT}
              className="stroke-border"
              strokeWidth={1}
            />
          )}
        </svg>

        {hovered && (
          <div className="pointer-events-none absolute left-0 top-0 rounded-md border border-border bg-card px-2 py-1 text-xs shadow-sm">
            <span className="font-medium text-foreground">{hovered.label}</span>
            {hovered.invoiced === null ? (
              <span className="ml-2 text-muted-foreground">not yet</span>
            ) : (
              <span className="ml-2 text-muted-foreground">
                {formatKobo(hovered.collected ?? 0)} of {formatKobo(hovered.invoiced)}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="mt-2 flex justify-between text-xs text-muted-foreground">
        <span>{buckets[0]!.label}</span>
        <span>{buckets.at(-1)!.label}</span>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Cumulative across {buckets.filter((b) => b.kind === "IN_TERM").length} week(s) of{" "}
        {data.termName}
        {buckets.some((b) => b.kind === "BEFORE_TERM") && ", including fees billed or paid before the term began"}
        {buckets.some((b) => b.kind === "AFTER_TERM") && ", including arrears settled after it ended"}. Totals
        match the cards above: {formatKobo(data.totalCollected)} collected of{" "}
        {formatKobo(data.totalInvoiced)} invoiced.
      </p>
    </div>
  );
}
