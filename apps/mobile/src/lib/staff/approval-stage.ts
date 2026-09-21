import type { ReportCardStatusDto } from "@school-kit/types";

// Where one class's report cards stand, and what a head can do about it.
//
// Pure, because the rules it mirrors are exact and a wrong answer is costly in
// both directions: offering "Approve" on a class that is not ready gets a 409
// the head cannot act on, and FAILING to offer it on a class that is ready
// leaves report cards stuck without anyone noticing.
//
// The server's rule (report-card-workflow.service.ts → assertAllInState) is
// that a batch transition requires EVERY card in the class to be in the right
// state first:
//
//   approve  — every card FORM_REVIEWED          → PRINCIPAL_APPROVED
//   release  — every card PRINCIPAL_APPROVED     → RELEASED
//
// So a class with 39 cards form-reviewed and 1 still with its subject teacher
// is NOT ready, and this says so rather than letting the head find out.

export type ArmStage =
  | "NOT_BUILT"
  | "WITH_TEACHERS"
  | "READY_TO_APPROVE"
  | "READY_TO_RELEASE"
  | "RELEASED";

export type StatusCounts = Record<ReportCardStatusDto, number>;

export function cardTotal(byStatus: StatusCounts): number {
  return (
    byStatus.DRAFT +
    byStatus.SUBJECT_REVIEWED +
    byStatus.FORM_REVIEWED +
    byStatus.PRINCIPAL_APPROVED +
    byStatus.RELEASED
  );
}

export function armStage(byStatus: StatusCounts): ArmStage {
  const total = cardTotal(byStatus);
  if (total === 0) return "NOT_BUILT";
  if (byStatus.RELEASED === total) return "RELEASED";
  if (byStatus.PRINCIPAL_APPROVED === total) return "READY_TO_RELEASE";
  if (byStatus.FORM_REVIEWED === total) return "READY_TO_APPROVE";
  return "WITH_TEACHERS";
}

/** The one-line status a head reads in the list. */
export function describeStage(stage: ArmStage, byStatus: StatusCounts): string {
  const total = cardTotal(byStatus);
  switch (stage) {
    case "NOT_BUILT":
      return "Report cards not built yet";
    case "RELEASED":
      return `Released — ${total} card${total === 1 ? "" : "s"} visible to families`;
    case "READY_TO_RELEASE":
      return "Approved — ready to release to families";
    case "READY_TO_APPROVE":
      return "Ready for your approval";
    case "WITH_TEACHERS": {
      const waiting = byStatus.DRAFT + byStatus.SUBJECT_REVIEWED;
      return waiting > 0
        ? `With teachers — ${waiting} of ${total} not yet reviewed by the form teacher`
        : "In progress";
    }
  }
}

/** Stages that need the head to act — listed first. */
export function stageNeedsAction(stage: ArmStage): boolean {
  return stage === "READY_TO_APPROVE" || stage === "READY_TO_RELEASE";
}
