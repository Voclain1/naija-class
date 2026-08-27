import type { ReportCardStatusDto } from "@school-kit/types";

import { WorkflowStatusBadge } from "@/components/report-cards/status-badges";
import { getWorkflowGuidance } from "@/components/report-cards/workflow-guidance-copy";

export function WorkflowGuidance({
  status,
  canManage,
  isOwner,
}: {
  status: ReportCardStatusDto | "MIXED";
  canManage: boolean;
  isOwner: boolean;
}) {
  const current = getWorkflowGuidance(status, canManage, isOwner);

  return (
    <div
      className={
        status === "MIXED"
          ? "rounded-md border border-amber-300/60 bg-amber-50 p-4 text-sm text-amber-900"
          : "rounded-md border bg-muted/20 p-4 text-sm"
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        {status !== "MIXED" && <WorkflowStatusBadge status={status} />}
        <p className="font-medium text-foreground">{current.heading}</p>
      </div>
      <p className="mt-1 text-muted-foreground">{current.detail}</p>
    </div>
  );
}
