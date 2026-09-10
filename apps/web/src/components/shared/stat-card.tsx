import type { ReactNode } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// Extracted from the dashboard rebuild's private `KpiCard` (dashboard/page.tsx)
// so other sections (Students, Staff, Finance, Report Cards) can show the same
// "data as hero" tile — label, large serif numeral, context line — instead of
// each re-deriving the same three-line Card by hand. Fully data-driven: no
// coupling to AdminDashboardDto or any other section's data shape.
const TONE_CLASSES: Record<NonNullable<StatCardProps["tone"]>, string> = {
  default: "text-foreground",
  // Fixed during the Finance restyle (Phase 1): the dashboard rebuild's
  // original KpiCard used text-secondary-foreground here, which is
  // indistinguishable from plain text in light mode and near-invisible in
  // dark mode (secondary-foreground dark ≈ card background dark — see
  // globals.css). Finance's own pre-existing "Outstanding balance" tile
  // already used real amber; this brings the shared tone in line with that
  // (and with Badge's "warning" variant) instead of the other way around.
  warning: "text-amber-700 dark:text-amber-400",
  // Added for Finance's net-position tile — a genuine polarity signal
  // (above/below zero), unlike the KPI row's other plain descriptive
  // numbers. Matches the finance dashboard's own pre-existing color choice.
  positive: "text-emerald-700 dark:text-emerald-400",
  negative: "text-red-700 dark:text-red-400",
};

interface StatCardProps {
  label: string;
  value: string;
  context?: string;
  tone?: "default" | "warning" | "positive" | "negative";
  className?: string;
  /**
   * Small glyph in the top-right corner. Purely decorative — it repeats what
   * `label` already says, so it is rendered aria-hidden and MUST NOT be the
   * only thing carrying a meaning.
   *
   * Additive and optional on purpose: this tile is shared by Students, Staff,
   * Finance and Report Cards as well as the dashboard, and every existing
   * call site must keep rendering exactly as before.
   */
  icon?: ReactNode;
  /**
   * A thin footer row under the context line, separated by a hairline rule —
   * for a secondary breakdown ("Collected … / Target …") or a meter. Same
   * additive rule as `icon`.
   */
  footer?: ReactNode;
}

export function StatCard({
  label,
  value,
  context,
  tone = "default",
  className,
  icon,
  footer,
}: StatCardProps) {
  return (
    <Card className={className}>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          {/* Decorative: it restates the label, so a screen reader announcing
              it would just be noise. */}
          {icon && (
            <span aria-hidden className="shrink-0 text-muted-foreground/70">
              {icon}
            </span>
          )}
        </div>
        <p
          className={cn(
            // Responsive: a naira figure like N1,530,000.00 is nine glyphs
            // plus separators and does not fit at text-3xl on a 430px phone —
            // it was rendering CLIPPED mid-digit on the finance dashboard.
            // Note the a11y overflow suite did NOT catch this: it checks
            // body-level overflow and offscreen-unreachable elements, and this
            // was text clipped INSIDE a card that itself fits.
            "mt-1 font-serif text-2xl font-medium tabular-nums sm:text-3xl",
            TONE_CLASSES[tone],
          )}
        >
          {value}
        </p>
        {context && <p className="mt-1 text-xs text-muted-foreground">{context}</p>}
        {footer && (
          <div className="mt-3 border-t border-border pt-2 text-xs text-muted-foreground">
            {footer}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
