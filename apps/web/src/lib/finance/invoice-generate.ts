// Review-and-confirm rules and state machine for BULK invoice generation.
//
// F-34: "Generate invoices" billed every enrolled student in a class arm on a
// single click, straight to the mutation. A Preview existed but was advisory
// and optional — nothing required the bursar to have looked at it, and the
// button restated neither a count nor a naira total.
//
// The asymmetry that made this P0: after F-01, cancelling ONE invoice requires
// an explicit confirmation naming the student and the amount, while creating
// THIRTY required none. That is exactly backwards by blast radius.
//
// This module follows invoice-cancel.ts deliberately — same reasons, restated
// because they are what make the guarantee testable at all:
//   1. apps/web's Vitest runner is node-environment and *.spec.ts only (no
//      DOM/RTL, a standing decision in apps/web/vitest.config.ts). Logic here
//      is the only logic that can be regression-tested at unit level.
//   2. The confirmation is a SAFETY property, not presentation. A component
//      may be re-laid-out freely; it must not be able to reach the request
//      without passing through `confirming`.
//
// Authorization is unchanged and still the server's: preview requires
// `invoice.read`, generation requires `invoice.issue`. Nothing here grants
// capability — a bursar who cannot issue still cannot, they simply learn it
// from a 403 rather than from a hidden button.

import type { PreviewLineDto } from "@school-kit/types";

// ---------------------------------------------------------------------------
// What a run will actually do
// ---------------------------------------------------------------------------

export interface GenerationScope {
  /** Human class-arm name, never an id. */
  armName: string;
  /** Human term name, never an id. */
  termName: string;
  /** Students who will receive a NEW invoice. */
  billableCount: number;
  /** Students the server will skip because they already have an invoice. */
  skippedCount: number;
  /** Sum of totalDue across billable students only, in kobo. */
  billableTotalDue: number;
  /** Distinct fee-item count contributing to a billable line, for context. */
  feeItemCount: number;
  /** Billable students, for the review list. */
  billable: PreviewLineDto[];
  /** Already-invoiced students, listed so the skip is visible, not implied. */
  skipped: PreviewLineDto[];
}

/**
 * Partition a preview into what generation will and will not do.
 *
 * The count and total are computed from BILLABLE lines only. Summing every
 * preview line — which is what the pre-F-34 screen displayed — overstates both
 * on any arm that has been billed before, and the re-run case is precisely
 * when a bursar most needs the number to be true.
 */
export function summariseGeneration(
  preview: PreviewLineDto[],
  armName: string,
  termName: string,
): GenerationScope {
  const billable = preview.filter((line) => !line.alreadyInvoiced);
  const skipped = preview.filter((line) => line.alreadyInvoiced);

  return {
    armName,
    termName,
    billableCount: billable.length,
    skippedCount: skipped.length,
    billableTotalDue: billable.reduce((sum, line) => sum + line.totalDue, 0),
    // Fee items are uniform across an arm (fetchFeeItems keys on class level /
    // arm / term / year, not on the student), so any billable line carries the
    // same count. Read it off the first rather than pretending to aggregate.
    feeItemCount: billable[0]?.feeItemCount ?? 0,
    billable,
    skipped,
  };
}

/**
 * True when a run would create nothing.
 *
 * §5's requirement: a "successful" run that bills nobody must not look like a
 * meaningful bulk action. Verified at runtime that the API returns
 * `201 {created: 0, skipped: 0}` for an empty arm — a success response
 * indistinguishable from a real one.
 */
export function isZeroImpact(scope: GenerationScope): boolean {
  return scope.billableCount === 0;
}

/** Why a run would create nothing — the three causes need different advice. */
export type ZeroImpactReason = "no-students" | "all-already-invoiced" | "no-fees";

export function zeroImpactReason(scope: GenerationScope): ZeroImpactReason | null {
  if (scope.billableCount > 0) return null;
  if (scope.skippedCount > 0) return "all-already-invoiced";
  // No billable and nothing skipped: either nobody is enrolled, or fees are
  // unpriced. feeItemCount is 0 in both (there is no billable line to read it
  // from), so the roster is what separates them.
  return scope.skipped.length === 0 && scope.billable.length === 0
    ? "no-students"
    : "no-fees";
}

// ---------------------------------------------------------------------------
// Confirmation copy
// ---------------------------------------------------------------------------

export interface GenerateConfirmation {
  title: string;
  /** What will be created, for whom, for which term — the F-34 sentence. */
  subject: string;
  consequence: string;
  confirmLabel: string;
  dismissLabel: string;
}

/**
 * @param formatAmount injected (not imported) so this module stays free of
 *   formatting concerns and testable without currency setup — same contract
 *   buildCancelConfirmation uses.
 */
export function buildGenerateConfirmation(
  scope: GenerationScope,
  formatAmount: (kobo: number) => string,
): GenerateConfirmation {
  const students = `${scope.billableCount} student${scope.billableCount === 1 ? "" : "s"}`;

  const subject = isZeroImpact(scope)
    ? `No invoices will be created for ${scope.armName} — ${scope.termName}.`
    : `${students} in ${scope.armName} will be invoiced ${formatAmount(scope.billableTotalDue)} in total for ${scope.termName}.`;

  const skipNote =
    scope.skippedCount > 0
      ? ` ${scope.skippedCount} student${scope.skippedCount === 1 ? "" : "s"} already ` +
        `${scope.skippedCount === 1 ? "has" : "have"} an invoice for this term and will be skipped. ` +
        "Cancelling an invoice does not undo this — a cancelled invoice still counts as issued for the term."
      : "";

  return {
    title: isZeroImpact(scope) ? "Nothing to invoice" : "Create these invoices?",
    subject,
    consequence: isZeroImpact(scope)
      ? "Nothing will be created or changed."
      : "Each student gets one invoice for this term, priced from the current fee catalogue." +
        skipNote,
    // Never a bare "Generate": the label restates the count so the button
    // itself says what it does, matching how "Cancel this invoice" reads.
    confirmLabel: isZeroImpact(scope)
      ? "Close"
      : `Create ${students === "1 student" ? "1 invoice" : `${scope.billableCount} invoices`}`,
    // Never "Cancel" — in a finance screen that word already means "void an
    // invoice". Same reasoning as buildCancelConfirmation's dismissLabel.
    dismissLabel: isZeroImpact(scope) ? "Close" : "Don't create",
  };
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------
//
// idle ──open──▶ loading ──loaded──▶ confirming ──submit──▶ submitting ──▶ idle
//                   │                     ▲                      │
//                   └──error──▶ failed    └───────error──────────┘
//
// Invariants, each covered in the sibling spec:
//   * `submit` is ONLY reachable from `confirming`. A component wiring the
//     button straight to the request would have to dispatch `submit` from
//     `idle`, which this refuses — the regression guard F-34 asks for.
//   * A second `submit` while `submitting` is a no-op: double-click cannot
//     produce two POSTs. (The backend is idempotent per student-term, so a
//     duplicate would not double-bill — but it would produce a second,
//     contradictory "Done" message, and relying on a data constraint to
//     excuse a UI defect is how the constraint eventually gets relaxed.)
//   * `dismiss` is refused while `submitting`: the outcome must be shown.
//   * Opening NEVER mutates. Loading a preview is a GET; the POST is only
//     reachable via `submit`.

export type GeneratePhase = "idle" | "loading" | "confirming" | "submitting";

export interface GenerateState {
  phase: GeneratePhase;
  scope: GenerationScope | null;
  error: string | null;
}

export type GenerateAction =
  | { type: "open" }
  | { type: "loaded"; scope: GenerationScope }
  | { type: "submit" }
  | { type: "success" }
  | { type: "error"; message: string }
  | { type: "dismiss" };

export const initialGenerateState: GenerateState = {
  phase: "idle",
  scope: null,
  error: null,
};

export function generateReducer(
  state: GenerateState,
  action: GenerateAction,
): GenerateState {
  switch (action.type) {
    case "open":
      // Refused mid-flight so an in-progress run cannot be silently
      // retargeted at a different arm or term.
      if (state.phase === "submitting") return state;
      return { phase: "loading", scope: null, error: null };

    case "loaded":
      if (state.phase !== "loading") return state;
      return { phase: "confirming", scope: action.scope, error: null };

    case "submit":
      // THE confirmation gate. Unreachable from `idle` by construction, and
      // refused for a zero-impact run so "Close" can share the button slot
      // without ever POSTing.
      if (state.phase !== "confirming") return state;
      if (!state.scope || isZeroImpact(state.scope)) return state;
      return { ...state, phase: "submitting", error: null };

    case "success":
      if (state.phase !== "submitting") return state;
      return initialGenerateState;

    case "error":
      // Reachable from `loading` (preview failed) and `submitting`
      // (generation failed). Both keep the dialog open showing why, and
      // neither optimistically reports success.
      if (state.phase === "loading") {
        return { phase: "confirming", scope: null, error: action.message };
      }
      if (state.phase !== "submitting") return state;
      return { ...state, phase: "confirming", error: action.message };

    case "dismiss":
      if (state.phase === "submitting") return state;
      return initialGenerateState;

    default:
      return state;
  }
}

/** True only when a generation request may legitimately be sent right now. */
export function shouldSendGenerateRequest(state: GenerateState): boolean {
  return (
    state.phase === "submitting" &&
    state.scope !== null &&
    !isZeroImpact(state.scope)
  );
}
