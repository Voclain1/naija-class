import { CircleDashed, Download, Loader2, TriangleAlert } from "lucide-react";

import type { ReportCardPdfStatusDto, ReportCardStatusDto } from "@school-kit/types";

import { cn } from "@/lib/utils";

const PILL = "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium";

// Workflow status badge — renders every state in the slice-6 approval lifecycle.
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
  return <span className={cn(PILL, tone[status])}>{label[status]}</span>;
}

// PDF generation status badge — the live signal the board polls on.
export function PdfStatusBadge({ status }: { status: ReportCardPdfStatusDto }) {
  switch (status) {
    case "PENDING":
      return (
        <span className={cn(PILL, "bg-muted text-muted-foreground")}>
          <CircleDashed className="h-3.5 w-3.5" />
          Not generated
        </span>
      );
    case "GENERATING":
      return (
        <span className={cn(PILL, "bg-amber-50 text-amber-700")}>
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Generating…
        </span>
      );
    case "GENERATED":
      return (
        <span className={cn(PILL, "bg-emerald-50 text-emerald-700")}>
          <Download className="h-3.5 w-3.5" />
          Ready
        </span>
      );
    case "FAILED":
      return (
        <span className={cn(PILL, "bg-destructive/10 text-destructive")}>
          <TriangleAlert className="h-3.5 w-3.5" />
          Failed
        </span>
      );
  }
}
