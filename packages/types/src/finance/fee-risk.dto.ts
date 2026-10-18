import { formatKobo } from "./format.js";

// Phase 9 / CP10.2 — fee-default risk (docs/modules/phase-9.md §19.3).
//
// Rules over the child's own invoices, not a model and not a score. Shown to
// those who read the debtor list (owner, admin, bursar) and never to families.
// Computed when asked, never stored, and it never acts by itself.
//
// Reasons travel as data — amounts in kobo — and are worded here, at the
// display layer, by feeRiskReasonText.

export const FEE_RISK_LEVELS = ["HIGH", "WATCH", "LOW", "TOO_NEW"] as const;
export type FeeRiskLevel = (typeof FEE_RISK_LEVELS)[number];

export const FEE_RISK_LEVEL_LABELS: Record<FeeRiskLevel, string> = {
  HIGH: "High",
  WATCH: "Watch",
  LOW: "Low",
  TOO_NEW: "Too new to say",
};

export type FeeRiskReason =
  /** Term invoices paid in full, but after their due date. */
  | { kind: "PAID_LATE"; count: number; of: number }
  /** Term invoices not paid in full by their due date (and still short then). */
  | { kind: "SHORT_AT_DUE"; count: number; of: number }
  /** A balance still open on an earlier term's invoices. */
  | { kind: "OWING_EARLIER"; termLabel: string; balance: number }
  /** Past its due date this term with money still owing. */
  | { kind: "OVERDUE_NOW"; balance: number }
  /** Every judged term paid by its due date. */
  | { kind: "ON_TIME"; of: number }
  /** Fewer than two terms of fees so far. */
  | { kind: "TOO_NEW" }
  /** A brother or sister (same primary guardian) is Watch or High. */
  | { kind: "SIBLING"; studentId: string; name: string; level: "HIGH" | "WATCH" };

export interface FeeRiskDto {
  level: FeeRiskLevel;
  reasons: FeeRiskReason[];
}

function terms(n: number): string {
  return n === 1 ? "term" : "terms";
}

export function feeRiskReasonText(r: FeeRiskReason): string {
  switch (r.kind) {
    case "PAID_LATE":
      return `Paid late in ${r.count} of the last ${r.of} ${terms(r.of)}`;
    case "SHORT_AT_DUE":
      return `Not paid in full by the due date in ${r.count} of the last ${r.of} ${terms(r.of)}`;
    case "OWING_EARLIER":
      return `${formatKobo(r.balance)} still owing from ${r.termLabel}`;
    case "OVERDUE_NOW":
      return `${formatKobo(r.balance)} overdue this term`;
    case "ON_TIME":
      return `Paid on time in the last ${r.of} ${terms(r.of)}`;
    case "TOO_NEW":
      return "Fewer than two terms of fees so far";
    case "SIBLING":
      return `Sibling of ${r.name} (${FEE_RISK_LEVEL_LABELS[r.level]})`;
  }
}

/** "Paid late in 2 of the last 3 terms; ₦45,000.00 still owing from Second Term 2025/2026". */
export function feeRiskSummary(risk: FeeRiskDto): string {
  return risk.reasons.map(feeRiskReasonText).join("; ");
}
