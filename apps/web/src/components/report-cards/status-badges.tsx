import { CircleDashed, Download, Loader2, TriangleAlert } from "lucide-react";

import type { ReportCardPdfStatusDto, ReportCardStatusDto } from "@school-kit/types";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const PILL = "gap-1.5 border-transparent";

// Workflow status badge — renders every state in the slice-6 approval lifecycle.
// Migrated onto the shared Badge primitive (Phase 3 restyle) — the tone map
// below is untouched from before the migration. Every color here signals a
// real workflow state (draft vs. reviewed vs. approved vs. released); the
// swap changes only the wrapper (rounded-md pill → shared Badge component,
// same shape unification Students/Staff went through), never which color
// maps to which state.
export function WorkflowStatusBadge({ status }: { status: ReportCardStatusDto }) {
  const label: Record<ReportCardStatusDto, string> = {
    DRAFT: "Draft",
    SUBJECT_REVIEWED: "Subjects reviewed",
    FORM_REVIEWED: "Form reviewed",
    PRINCIPAL_APPROVED: "Principal approved",
    RELEASED: "Released",
  };
  // Distinguishable per state: gray → amber → blue → purple → green.
  const tone: Record<ReportCardStatusDto, string> = {
    DRAFT: "bg-muted text-muted-foreground",
    SUBJECT_REVIEWED: "bg-amber-50 text-amber-700",
    FORM_REVIEWED: "bg-blue-50 text-blue-700",
    PRINCIPAL_APPROVED: "bg-violet-50 text-violet-700",
    RELEASED: "bg-emerald-50 text-emerald-700",
  };
  return (
    <Badge variant="outline" className={cn(PILL, tone[status])}>
      {label[status]}
    </Badge>
  );
}

// PDF generation status badge — the live signal the board polls on. Same
// migration, same discipline: colors and icons preserved exactly per state.
export function PdfStatusBadge({ status }: { status: ReportCardPdfStatusDto }) {
  switch (status) {
    case "PENDING":
      return (
        <Badge variant="outline" className={cn(PILL, "bg-muted text-muted-foreground")}>
          <CircleDashed className="h-3.5 w-3.5" />
          Not generated
        </Badge>
      );
    case "GENERATING":
      return (
        <Badge variant="outline" className={cn(PILL, "bg-amber-50 text-amber-700")}>
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Generating…
        </Badge>
      );
    case "GENERATED":
      return (
        <Badge variant="outline" className={cn(PILL, "bg-emerald-50 text-emerald-700")}>
          <Download className="h-3.5 w-3.5" />
          Ready
        </Badge>
      );
    case "FAILED":
      return (
        <Badge variant="outline" className={cn(PILL, "bg-destructive/10 text-destructive")}>
          <TriangleAlert className="h-3.5 w-3.5" />
          Failed
        </Badge>
      );
  }
}
