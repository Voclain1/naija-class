import { CircleDashed, Download, Loader2, TriangleAlert } from "lucide-react";

import type { ReportCardPdfStatusDto, ReportCardStatusDto } from "@school-kit/types";

import { cn } from "@/lib/utils";

const PILL = "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium";

// Workflow status badge. Slice 5 cards are all DRAFT; the later workflow states
// land in slice 6 but are rendered here so the badge is forward-compatible.
export function WorkflowStatusBadge({ status }: { status: ReportCardStatusDto }) {
  const label: Record<ReportCardStatusDto, string> = {
    DRAFT: "Draft",
    SUBJECT_REVIEWED: "Subject reviewed",
    FORM_REVIEWED: "Form reviewed",
    PRINCIPAL_APPROVED: "Approved",
    RELEASED: "Released",
  };
  const tone: Record<ReportCardStatusDto, string> = {
    DRAFT: "bg-muted text-muted-foreground",
    SUBJECT_REVIEWED: "bg-sky-50 text-sky-700",
    FORM_REVIEWED: "bg-indigo-50 text-indigo-700",
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
