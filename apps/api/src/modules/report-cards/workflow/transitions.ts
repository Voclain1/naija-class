import { ConflictError, type ReportCardStatusDto } from "@school-kit/types";

// Pure report-card state-machine helpers (Phase 2 / Slice 6). No DB, no I/O —
// just the legal-transition shape + the precondition assertion every arm-batch
// transition runs INSIDE its withTenant tx (the spec's race answer: re-check,
// 409 rather than half-apply).

// The happy-path forward edges, for documentation + tests. The actual gates use
// explicit allowed-source sets per endpoint (form-review accepts DRAFT *or*
// SUBJECT_REVIEWED as a source — the all-signed-off re-check is the real gate —
// so it isn't a single-edge lookup).
export const LEGAL_FORWARD_TRANSITIONS: Record<ReportCardStatusDto, ReportCardStatusDto[]> = {
  DRAFT: ["SUBJECT_REVIEWED"],
  SUBJECT_REVIEWED: ["FORM_REVIEWED"],
  FORM_REVIEWED: ["PRINCIPAL_APPROVED"],
  PRINCIPAL_APPROVED: ["RELEASED"],
  RELEASED: [],
};

// Every card in the arm must currently be in one of `allowed`, else 409. Empty
// arm (no cards built) is also a 409 — there's nothing to transition. Cards in
// an arm share a status by invariant (batch transitions + build), but a mix is
// possible mid-flow (e.g. form-review accepts DRAFT+SUBJECT_REVIEWED), so we
// check every card.
export function assertAllInState(
  cards: readonly { status: ReportCardStatusDto }[],
  allowed: readonly ReportCardStatusDto[],
  action: string,
): void {
  if (cards.length === 0) {
    throw new ConflictError("NO_REPORT_CARDS", `No report cards to ${action} — build the arm first.`);
  }
  const offending = cards.some((c) => !allowed.includes(c.status));
  if (offending) {
    const states = distinctStatuses(cards).join(", ");
    throw new ConflictError(
      "INVALID_TRANSITION",
      `Cannot ${action}: the arm is in state(s) [${states}], expected one of [${allowed.join(", ")}].`,
    );
  }
}

// Distinct statuses across the arm, sorted — used for the audit `fromStatus`.
export function distinctStatuses(cards: readonly { status: ReportCardStatusDto }[]): ReportCardStatusDto[] {
  return [...new Set(cards.map((c) => c.status))].sort() as ReportCardStatusDto[];
}
