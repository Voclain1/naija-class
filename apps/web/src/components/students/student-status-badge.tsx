"use client";

import type { StudentStatusDto } from "@school-kit/types";

import { cn } from "@/lib/utils";

interface Props {
  status: StudentStatusDto;
  className?: string;
}

const STYLES: Record<StudentStatusDto, string> = {
  ACTIVE: "bg-emerald-100 text-emerald-700",
  INACTIVE: "bg-muted text-muted-foreground",
  SUSPENDED: "bg-amber-100 text-amber-800",
  WITHDRAWN: "bg-rose-100 text-rose-700",
  GRADUATED: "bg-sky-100 text-sky-700",
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
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        STYLES[status],
        className,
      )}
    >
      {LABELS[status]}
    </span>
  );
}
