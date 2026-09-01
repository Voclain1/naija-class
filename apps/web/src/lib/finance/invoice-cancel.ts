// Cancellation rules and state machine for a single invoice.
//
// F-01: cancelling an invoice used to be ONE click on a text button in a
// table row, wired straight to the mutation, with the only failure handling
// being `console.error`. A mis-tapped row voided a real invoice, the screen
// showed nothing, and a failure was completely invisible — the row simply
// did not change and the bursar had no way to tell "it failed" from "it did
// nothing".
//
// The fix keeps ALL policy in this pure module rather than inside the
// component, for two reasons:
//   1. apps/web's Vitest runner is node-environment and *.spec.ts only (no
//      DOM/RTL — a deliberate standing decision, see apps/web/vitest.config.ts).
//      Logic that lives here is the only logic that can be regression-tested
//      at the unit level at all.
//   2. The confirmation is a SAFETY property, not a presentation detail. A
//      component can be re-laid-out freely; it must not be able to reach the
//      request without passing through `confirming`.
//
// Authorization and accounting semantics are unchanged: the backend still
// owns invoice.cancel permission, the has-payments / already-cancelled /
// refunded conflicts, the audit row, and the payment-link invalidation.
// Nothing here re-implements or second-guesses any of that.

import type { InvoiceStatus } from "@school-kit/types";

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------
//
// Cancelling is gated on TWO independent things, and the affordance must
// reflect both:
//
//   1. WORKFLOW STATE — mirrors InvoiceGenerationService.cancel's status
//      guards (PARTIALLY_PAID / PAID / CANCELLED / REFUNDED are refused).
//   2. PERMISSION — the endpoint is `@Permissions("invoice.cancel")`.
//
// Only (1) was ever checked here. A signed-in user holding `invoice.read`
// but NOT `invoice.cancel` was shown a live "Cancel invoice…" control on a
// perfectly cancellable invoice, and the 403 was the first and only thing
// that told them otherwise. That is the frontend deferring a money-adjacent
// permission decision to a downstream 4xx, which this codebase does not do
// for invoice balances and should not do for this either.
//
// Both remain affordance filters — the server re-checks both and stays the
// authority. Nothing here is load-bearing for security; it is load-bearing
// for the UI telling the truth about what this user may do.

// Mirrors InvoiceGenerationService.cancel's guards.
const CANCELLABLE: ReadonlySet<InvoiceStatus> = new Set<InvoiceStatus>([
  "DRAFT",
  "ISSUED",
  "OVERDUE",
]);

/** The permission `POST /invoices/:id/cancel` is declared with. */
export const CANCEL_INVOICE_PERMISSION = "invoice.cancel";

/**
 * Wildcard-aware permission test, matching the `permissions.includes("*")`
 * convention used by the nine other copies of this helper across `apps/web`
 * (sidebar, BVN section, guardians tab, and six pages). Extracting a shared
 * hook is tracked in `docs/deferred.md` and deliberately not done here — but
 * unlike the other nine, this copy is exported and unit-tested, so it is the
 * one to move when that extraction happens rather than the seed of an
 * eleventh.
 */
export function hasPermission(permissions: readonly string[], permission: string): boolean {
  return permissions.includes("*") || permissions.includes(permission);
}

/**
 * True only when this user may cancel THIS invoice right now.
 *
 * `permissions` is a required parameter, not an optional one with a
 * permissive default: a call site that forgets it fails typecheck instead of
 * silently reverting to status-only gating. It is also why an unknown or
 * still-loading auth state (`[]`) correctly yields `false` — while the app
 * does not yet know what the user may do, it must not offer to void an
 * invoice.
 */
export function canCancelInvoice(
  status: InvoiceStatus,
  permissions: readonly string[],
): boolean {
  return hasPermission(permissions, CANCEL_INVOICE_PERMISSION) && CANCELLABLE.has(status);
}

// ---------------------------------------------------------------------------
// Confirmation copy
// ---------------------------------------------------------------------------

export interface CancelTarget {
  id: string;
  studentId: string;
  studentName: string | null;
  admissionNumber: string | null;
  totalDue: number; // kobo
  totalPaid: number; // kobo
  status: InvoiceStatus;
}

export interface CancelConfirmation {
  /** Dialog title. Names the action in full — never the bare word "Cancel". */
  title: string;
  /** Who and how much, so the bursar can check they picked the right row. */
  subject: string;
  /** What actually happens, in plain language. */
  consequence: string;
  /** Label of the button that performs the destructive action. */
  confirmLabel: string;
  /** Label of the button that backs out. Never "Cancel" — see below. */
  dismissLabel: string;
}

/**
 * Build the confirmation shown before an invoice is voided.
 *
 * The "Cancel" ambiguity is the whole reason this returns labels rather than
 * letting the component pick them: in a cancel-an-invoice dialog, a button
 * reading "Cancel" means BOTH "void the invoice" and "close this dialog".
 * The dismiss button therefore says "Keep invoice" and the destructive one
 * says "Cancel this invoice" — neither can be read as the other.
 *
 * @param formatAmount injected (rather than imported) so this module stays
 *   free of formatting concerns and testable without currency setup.
 */
export function buildCancelConfirmation(
  invoice: CancelTarget,
  formatAmount: (kobo: number) => string,
  studentLabel: string,
): CancelConfirmation {
  const reference = invoice.id.slice(0, 8).toUpperCase();
  const admission = invoice.admissionNumber?.trim();
  const who = admission ? `${studentLabel} (${admission})` : studentLabel;

  return {
    title: "Cancel this invoice?",
    subject: `Invoice ${reference} for ${who} — ${formatAmount(invoice.totalDue)}.`,
    consequence:
      "The invoice will be marked cancelled and will stop counting towards " +
      "what this student owes. Any payment link already shared for it stops " +
      "working. This cannot be undone — to bill the student again you must " +
      "issue a new invoice.",
    confirmLabel: "Cancel this invoice",
    dismissLabel: "Keep invoice",
  };
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------
//
// idle ──open──▶ confirming ──submit──▶ submitting ──success──▶ idle
//                    ▲                       │
//                    └────────error──────────┘   (stays confirming, with error)
//
// The invariants this encodes, each covered by a test in the sibling spec:
//   * `submit` is ONLY reachable from `confirming`. A component that wired a
//     row button straight to the request would have to dispatch `submit`
//     from `idle`, which this machine refuses — that is the regression guard
//     F-01 asks for.
//   * A second `submit` while already `submitting` is a no-op, so a
//     double-click cannot produce two POSTs.
//   * `dismiss` is refused while `submitting`: the request is already in
//     flight and the outcome must be shown, not escaped.
//   * `error` returns to `confirming` WITH the message — the invoice's
//     displayed state is never optimistically changed, so what the row shows
//     after a failure is still the truth from the server.

export type CancelPhase = "idle" | "confirming" | "submitting";

export interface CancelState {
  phase: CancelPhase;
  /** The invoice being cancelled; null in `idle`. */
  target: CancelTarget | null;
  /** Human-facing failure copy from the last attempt, if any. */
  error: string | null;
}

export type CancelAction =
  | { type: "open"; target: CancelTarget }
  | { type: "submit" }
  | { type: "success" }
  | { type: "error"; message: string }
  | { type: "dismiss" };

export const initialCancelState: CancelState = {
  phase: "idle",
  target: null,
  error: null,
};

export function cancelReducer(state: CancelState, action: CancelAction): CancelState {
  switch (action.type) {
    case "open":
      // Opening is refused mid-flight so an in-progress cancellation cannot
      // be silently retargeted at a different invoice.
      if (state.phase === "submitting") return state;
      return { phase: "confirming", target: action.target, error: null };

    case "submit":
      // THE confirmation gate. Unreachable from `idle` by construction.
      if (state.phase !== "confirming") return state;
      return { ...state, phase: "submitting", error: null };

    case "success":
      if (state.phase !== "submitting") return state;
      return initialCancelState;

    case "error":
      if (state.phase !== "submitting") return state;
      // Back to `confirming`, not `idle`: the dialog stays open showing why
      // it failed, and the invoice row is left exactly as the server has it.
      return { ...state, phase: "confirming", error: action.message };

    case "dismiss":
      if (state.phase === "submitting") return state;
      return initialCancelState;

    default:
      return state;
  }
}

/** True only when a request may legitimately be sent right now. */
export function shouldSendCancelRequest(state: CancelState): boolean {
  return state.phase === "submitting" && state.target !== null;
}
