"use client";

import type { StudentStatusDto } from "@school-kit/types";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Props {
  status: StudentStatusDto;
  className?: string;
}

// Migrated onto the shared Badge primitive during the Students & Staff
// restyle (Phase 2) — badge.tsx's own comment flagged this file (and
// report-cards/status-badges.tsx) as the intended drop-in migration once
// their section's turn came. WITHDRAWN/GRADUATED have no dedicated Badge
// variant (Badge only ships success/warning/muted/destructive/outline), so
// those two keep their own rose/sky tone via `className` on top of
// `outline` — same override mechanism StatCard uses for positive/negative.
const VARIANTS: Record<StudentStatusDto, "success" | "muted" | "warning" | "outline"> = {
  ACTIVE: "success",
  INACTIVE: "muted",
  SUSPENDED: "warning",
  WITHDRAWN: "outline",
  GRADUATED: "outline",
};

const TONE_OVERRIDES: Partial<Record<StudentStatusDto, string>> = {
  WITHDRAWN: "border-transparent bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
  GRADUATED: "border-transparent bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
};

const LABELS: Record<StudentStatusDto, string> = {
  ACTIVE: "Active",
  INACTIVE: "Inactive",
  SUSPENDED: "Suspended",
  WITHDRAWN: "Withdrawn",
  GRADUATED: "Graduated",
};

export function StudentStatusBadge({ status, className }: Props) {
  return (
    <Badge variant={VARIANTS[status]} className={cn(TONE_OVERRIDES[status], className)}>
      {LABELS[status]}
    </Badge>
  );
}
