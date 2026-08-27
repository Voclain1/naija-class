import type { ReportCardStatusDto } from "@school-kit/types";

export interface WorkflowGuidanceCopy {
  heading: string;
  detail: string;
}

// Kept separate from the component so every workflow/role message is pinned
// by a focused regression test without rendering the entire report-card board.
export function getWorkflowGuidance(
  status: ReportCardStatusDto | "MIXED",
  canManage: boolean,
  isOwner: boolean,
): WorkflowGuidanceCopy {
  if (status === "MIXED") {
    return {
      heading: "This arm needs administrator attention.",
      detail: "Its report cards are in inconsistent workflow states, so no further action should be taken here.",
    };
  }

  const guidance: Record<ReportCardStatusDto, WorkflowGuidanceCopy> = {
    DRAFT: {
      heading: "Results are still being prepared.",
      detail: "Subject teachers need to sign off every subject before this arm can be submitted for form review.",
    },
    SUBJECT_REVIEWED: {
      heading: "All subjects have been reviewed.",
      detail: "Next, the form teacher reviews the arm and submits it for form review.",
    },
    FORM_REVIEWED: {
      heading: "Submitted for principal approval.",
      detail: canManage
        ? "An owner or administrator needs to approve the arm before it can be released."
        : "An owner or administrator needs to approve the arm before it can be released. You do not need to take action now.",
    },
    PRINCIPAL_APPROVED: {
      heading: "Approved and ready to release.",
      detail: canManage
        ? "Release will publish this arm's results to the relevant families and students."
        : "An owner or administrator will release the results to the relevant families and students. You do not need to take action now.",
    },
    RELEASED: {
      heading: "Results have been released to families and students.",
      detail: isOwner
        ? "PDFs may still be generating. If a correction is needed, you can reopen the arm with a recorded reason; families may already have seen the results."
        : canManage
          ? "PDFs may still be generating. If a correction is needed, ask the school owner to reopen the arm; families may already have seen the results."
          : "PDFs may still be generating. You do not need to take action now.",
    },
  };

  const copy = guidance[status];
  if (!copy) throw new Error(`Unknown report-card workflow state: ${status}`);
  return copy;
}
