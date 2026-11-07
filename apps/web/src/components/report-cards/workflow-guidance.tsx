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

  const steps = [
    "Prepare scores",
    "Review each card",
    "School approval",
    "Release results",
    "Download & print",
  ];
  const stepByStatus: Record<ReportCardStatusDto, number> = {
    DRAFT: 0,
    SUBJECT_REVIEWED: 1,
    FORM_REVIEWED: 2,
    PRINCIPAL_APPROVED: 3,
    RELEASED: 4,
  };
  const currentStep = status === "MIXED" ? null : stepByStatus[status];
  return (
    <div
      className={
        status === "MIXED"
          ? "rounded-md border border-amber-300/60 bg-amber-50 p-4 text-sm text-amber-900"
          : "rounded-md border bg-muted/20 p-4 text-sm"
      }
    >
      {currentStep !== null && (
        <ol
          aria-label="Report card steps"
          className="mb-4 grid gap-2 sm:grid-cols-5"
        >
          {steps.map((label, index) => (
            <li
              key={label}
              aria-current={index === currentStep ? "step" : undefined}
              className={`flex items-center gap-2 rounded-md px-2 py-2 text-xs ${index === currentStep ? "bg-primary/10 font-semibold text-foreground" : "text-muted-foreground"}`}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border bg-background">
                {index < currentStep ? "✓" : index + 1}
              </span>
              {label}
            </li>
          ))}
        </ol>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {status !== "MIXED" && <WorkflowStatusBadge status={status} />}
        <p className="font-medium text-foreground">{current.heading}</p>
      </div>
      <p className="mt-1 text-muted-foreground">{current.detail}</p>
    </div>
  );
}
