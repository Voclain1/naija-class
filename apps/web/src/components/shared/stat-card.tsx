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
}

export function StatCard({ label, value, context, tone = "default", className }: StatCardProps) {
  return (
    <Card className={className}>
      <CardContent className="pt-6">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className={cn("mt-1 font-serif text-3xl font-medium", TONE_CLASSES[tone])}>{value}</p>
        {context && <p className="mt-1 text-xs text-muted-foreground">{context}</p>}
      </CardContent>
    </Card>
  );
}
