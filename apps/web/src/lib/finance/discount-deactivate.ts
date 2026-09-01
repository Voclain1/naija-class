// Confirmation rules and state machine for deactivating a discount rule.
//
// Verified in a real browser 2026-09-01: the discounts table's "Deactivate"
// was a bare row button wired straight to the mutation. One click, no dialog,
// and the server had already set `active = false` before the bursar could
// react — the same shape F-01 fixed for invoice cancellation and F-34 for
// bulk generation. This was the last destructive finance action still wired
// that way.
//
// Why a discount rule deserves the same treatment as a cancelled invoice:
//
//   * It is money-adjacent. The rule is why a student is billed less; losing
//     it silently raises what a family is asked to pay on the next invoice.
//   * It is NOT undoable from the UI. There is no reactivate endpoint —
//     DELETE /discount-rules/:id only ever sets `active = false`. Recovering
//     means re-creating the rule by hand, and only if someone noticed.
//   * The row button identified nothing. Its accessible name was the bare
//     word "Deactivate", so with several rules listed a screen-reader user
//     heard N identical buttons and a mis-tap was invisible.
//
// This module deliberately mirrors `invoice-cancel.ts` rather than sharing
// with it. The two carry different targets and different copy, and the
// duplication is ~1 reducer; the alternative is a generic confirmation
// machine parameterised over both, which is a bigger change than closing this
// gap warrants. See docs/deferred.md if a third destructive finance action
// appears — that is the point to extract, not now.
//
// Policy lives here rather than in the component for the same reason it does
// in invoice-cancel.ts: apps/web's Vitest runner is node-environment and
// *.spec.ts only, so this module is the only place the guarantee can be
// regression-tested at the unit level.

import type { DiscountRuleDto } from "@school-kit/types";

// ---------------------------------------------------------------------------
// Confirmation copy
// ---------------------------------------------------------------------------

export interface DeactivateTarget {
  id: string;
  name: string;
  /** Rendered value, e.g. "50.00%" or "₦5,000.00" — formatted by the caller. */
  valueLabel: string;
  /** What the rule applies to, e.g. "Item: Term tuition". */
  scopeLabel: string;
}

export interface DeactivateConfirmation {
  title: string;
  /** Which rule, and worth how much — so a mis-tapped row is caught here. */
  subject: string;
  /** What actually happens, including what does NOT happen. */
  consequence: string;
  confirmLabel: string;
  dismissLabel: string;
}

/**
 * Build the confirmation shown before a discount rule is switched off.
 *
 * The dismiss button says "Keep discount", never "Cancel": on a screen about
 * removing a benefit, "Cancel" reads as both "cancel the discount" and "close
 * this dialog". Same reasoning as buildCancelConfirmation's "Keep invoice".
 */
export function buildDeactivateConfirmation(
  rule: DeactivateTarget,
  studentLabel: string,
): DeactivateConfirmation {
  return {
    title: "Deactivate this discount?",
    subject: `${rule.name} — ${rule.valueLabel} off ${rule.scopeLabel}, for ${studentLabel}.`,
    consequence:
      "Invoices already issued keep this discount and do not change. New " +
      "invoices will be billed at the full amount. This cannot be undone — " +
      "to give the discount back you must create it again.",
    confirmLabel: "Deactivate discount",
    dismissLabel: "Keep discount",
  };
}

/** Convenience: the fields the page already renders, narrowed to the target. */
export function toDeactivateTarget(
  rule: DiscountRuleDto,
  valueLabel: string,
  scopeLabel: string,
): DeactivateTarget {
  return { id: rule.id, name: rule.name, valueLabel, scopeLabel };
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------
//
// idle ──open──▶ confirming ──submit──▶ submitting ──success──▶ idle
//                    ▲                       │
//                    └────────error──────────┘   (stays confirming, with error)
//
// The invariant that matters: `submit` is reachable ONLY from `confirming`.
// A component that wires a row button straight to the request again would
// have to dispatch `submit` from `idle`, which this refuses — so the
// regression that prompted this module cannot come back silently.

export type DeactivatePhase = "idle" | "confirming" | "submitting";

export interface DeactivateState {
  phase: DeactivatePhase;
  target: DeactivateTarget | null;
  error: string | null;
}

export type DeactivateAction =
  | { type: "open"; target: DeactivateTarget }
  | { type: "submit" }
  | { type: "success" }
  | { type: "error"; message: string }
  | { type: "dismiss" };

export const initialDeactivateState: DeactivateState = {
  phase: "idle",
  target: null,
  error: null,
};

export function deactivateReducer(
  state: DeactivateState,
  action: DeactivateAction,
): DeactivateState {
  switch (action.type) {
    case "open":
      // Refused mid-flight so an in-progress deactivation cannot be silently
      // retargeted at a different rule.
      if (state.phase === "submitting") return state;
      return { phase: "confirming", target: action.target, error: null };

    case "submit":
      // THE confirmation gate.
      if (state.phase !== "confirming") return state;
      return { ...state, phase: "submitting", error: null };

    case "success":
      if (state.phase !== "submitting") return state;
      return initialDeactivateState;

    case "error":
      // Back to `confirming`, not `idle`: the dialog stays open showing why it
      // failed, and the row keeps showing the truth from the server.
      if (state.phase !== "submitting") return state;
      return { ...state, phase: "confirming", error: action.message };

    case "dismiss":
      // Refused while submitting — the request is already in flight and its
      // outcome must be seen, not escaped.
      if (state.phase === "submitting") return state;
      return initialDeactivateState;

    default:
      return state;
  }
}

/** True only when a request may legitimately be sent right now. */
export function shouldSendDeactivateRequest(state: DeactivateState): boolean {
  return state.phase === "submitting" && state.target !== null;
}
