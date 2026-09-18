// The promotion screen's client-side state: one decision per student.
//
// Pure and separately tested, for the same reason
// lib/enrollments/carry-over-selection.ts is — what gets pre-selected on a
// bulk screen is precisely what went wrong on 2026-08-25, so the defaults live
// somewhere they can be asserted rather than inside a component.

import type {
  PromotionAction,
  PromotionCandidateDto,
  PromotionDecisionInput,
  PromotionPreviewDto,
} from "@school-kit/types";

export interface PromotionRowDecision {
  action: PromotionAction;
  /** Destination arm for PROMOTE/REPEAT. Null means "not decided yet". */
  classArmId: string | null;
}

export type PromotionPlan = Map<string, PromotionRowDecision>;

/**
 * The starting plan, taken verbatim from what the server proposed.
 *
 * The client NEVER invents a selection the preview did not make: if the server
 * could not resolve a destination arm, the row starts as EXCLUDE with no arm,
 * and an admin has to say what should happen. A pre-filled guess here is the
 * exact failure this feature replaced.
 */
export function initialPlan(preview: PromotionPreviewDto): PromotionPlan {
  const plan: PromotionPlan = new Map();
  for (const row of preview.candidates) {
    plan.set(row.studentId, {
      action: row.proposedAction,
      classArmId: row.proposedClassArmId,
    });
  }
  return plan;
}

/**
 * Change one row's action, keeping the destination arm coherent with it:
 * REPEAT means the student's own arm, GRADUATE and EXCLUDE mean no arm at all
 * (the API rejects a `classArmId` on either).
 */
export function setAction(
  plan: PromotionPlan,
  row: PromotionCandidateDto,
  action: PromotionAction,
): PromotionPlan {
  const next = new Map(plan);
  if (action === "PROMOTE") {
    next.set(row.studentId, { action, classArmId: row.proposedClassArmId });
  } else if (action === "REPEAT") {
    next.set(row.studentId, { action, classArmId: row.sourceClassArmId });
  } else {
    next.set(row.studentId, { action, classArmId: null });
  }
  return next;
}

export function setClassArm(
  plan: PromotionPlan,
  studentId: string,
  classArmId: string,
): PromotionPlan {
  const current = plan.get(studentId);
  if (!current) return plan;
  const next = new Map(plan);
  next.set(studentId, { ...current, classArmId });
  return next;
}

/**
 * Apply one action to every row in a source arm — the "whole class" control.
 * Still a per-student plan underneath; this only saves clicking.
 */
export function setActionForArm(
  plan: PromotionPlan,
  rows: PromotionCandidateDto[],
  sourceClassArmId: string,
  action: PromotionAction,
): PromotionPlan {
  let next = plan;
  for (const row of rows) {
    if (row.sourceClassArmId === sourceClassArmId) {
      next = setAction(next, row, action);
    }
  }
  return next;
}

/** Point every still-unplaced row of one source arm at a destination arm. */
export function resolveArmGap(
  plan: PromotionPlan,
  rows: PromotionCandidateDto[],
  sourceClassArmId: string,
  destinationClassArmId: string,
): PromotionPlan {
  let next = plan;
  for (const row of rows) {
    if (row.sourceClassArmId !== sourceClassArmId) continue;
    next = setAction(next, row, "PROMOTE");
    next = setClassArm(next, row.studentId, destinationClassArmId);
  }
  return next;
}

export interface PromotionPlanSummary {
  promote: number;
  repeat: number;
  graduate: number;
  exclude: number;
  /** PROMOTE/REPEAT rows with no destination arm — the commit blocker. */
  unplaced: number;
  /** Everything that would actually be written. */
  actionable: number;
}

export function summarise(
  plan: PromotionPlan,
  rows: PromotionCandidateDto[],
): PromotionPlanSummary {
  const summary: PromotionPlanSummary = {
    promote: 0,
    repeat: 0,
    graduate: 0,
    exclude: 0,
    unplaced: 0,
    actionable: 0,
  };
  for (const row of rows) {
    const decision = plan.get(row.studentId);
    if (!decision) continue;
    if (decision.action === "PROMOTE") summary.promote += 1;
    else if (decision.action === "REPEAT") summary.repeat += 1;
    else if (decision.action === "GRADUATE") summary.graduate += 1;
    else summary.exclude += 1;

    const needsArm =
      decision.action === "PROMOTE" || decision.action === "REPEAT";
    if (needsArm && !decision.classArmId) summary.unplaced += 1;
    if (decision.action !== "EXCLUDE") summary.actionable += 1;
  }
  return summary;
}

/**
 * The commit payload. EXCLUDE rows are dropped rather than sent: the API
 * ignores them, and a payload naming only the students who actually move is
 * the one that reads correctly in the audit log.
 *
 * Returns null when something is still unplaced — the caller keeps the button
 * disabled rather than sending a half-decided plan.
 */
export function toDecisions(
  plan: PromotionPlan,
  rows: PromotionCandidateDto[],
): PromotionDecisionInput[] | null {
  const decisions: PromotionDecisionInput[] = [];
  for (const row of rows) {
    const decision = plan.get(row.studentId);
    if (!decision || decision.action === "EXCLUDE") continue;
    if (decision.action === "GRADUATE") {
      decisions.push({ studentId: row.studentId, action: "GRADUATE" });
      continue;
    }
    if (!decision.classArmId) return null;
    decisions.push({
      studentId: row.studentId,
      action: decision.action,
      classArmId: decision.classArmId,
    });
  }
  return decisions;
}
