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
      detail: "Check that scores are entered and each subject teacher has signed off. Open each student’s card to save their comments, development ratings and report details before sending the class for approval.",
    },
    SUBJECT_REVIEWED: {
      heading: "All subjects have been reviewed.",
      detail: "Open each student’s card and check the scores. Save the teacher’s comment, development ratings and report details, then choose “Send for approval”. This locks the teacher’s entries for review.",
    },
    FORM_REVIEWED: {
      heading: "Submitted for principal approval.",
      detail: canManage
        ? "Check the cards and add the principal’s remark. In the final term, set every student’s promotion decision. Then choose “Approve report cards”. Parents cannot see the results yet."
        : "The school is checking the cards for approval. Parents cannot see these results yet. You do not need to take action now.",
    },
    PRINCIPAL_APPROVED: {
      heading: "Approved and ready to release.",
      detail: canManage
        ? "Choose “Release results”, check the class and term, then choose whether families need a result PIN. Nothing is published until you confirm."
        : "An owner or administrator will release the results to the relevant families and students. You do not need to take action now.",
    },
    RELEASED: {
      heading: "Results have been released to families and students.",
      detail: isOwner
        ? "Wait for each PDF to show “Ready”, then choose “Download PDF” to print it. If you need a correction, you can reopen the arm with a recorded reason; families may already have seen the results."
        : canManage
          ? "Wait for each PDF to show “Ready”, then choose “Download PDF” to print it. If you need a correction, ask the school owner to reopen the arm; families may already have seen the results."
          : "PDFs may still be generating. You do not need to take action now.",
    },
  };

  const copy = guidance[status];
  if (!copy) throw new Error(`Unknown report-card workflow state: ${status}`);
  return copy;
}
