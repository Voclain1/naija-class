-- Phase 3 / Slice 11 — Refunds & Reversals
--
-- Adds RefundStatus enum and the refunds table.
--
-- A Refund records money returned to a parent (Paystack API path) or an
-- administrative reversal of a manual payment error. Creating a Refund always
-- marks the linked Payment as REVERSED and recomputes invoice.totalPaid + status.
--
-- Full reversals only in slice 11: amount === payment.amount. Partial refunds
-- are deferred and require a different totalPaid computation strategy.
--
-- status PROCESSED: immediate for manual payments; result of Paystack refund API
--   for Paystack payments. FAILED is stored when the Paystack API rejects the
--   refund (no DB state is changed in that path). REQUESTED is reserved for a
--   future async refund queue.
--
-- processedBy: userId of the admin/owner who initiated the refund.
--
-- FK to payments uses RESTRICT: a refund row blocks payment deletion
-- (payments are never hard-deleted in practice, but the guard is belt-and-suspenders).
--
-- Money column (amount) is INTEGER (kobo) — never FLOAT. CLAUDE.md money hard rule.
--
-- app_user grants: ALTER DEFAULT PRIVILEGES (set up in slice 1 / Neon setup)
-- auto-grants SELECT/INSERT/UPDATE/DELETE on every future table created by
-- school_kit to app_user — no manual GRANT needed (same pattern as slices 4–10).

-- ─────────────────────────────────────────────────────────────────────────────
-- Enum
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'PROCESSED', 'FAILED');

-- ─────────────────────────────────────────────────────────────────────────────
-- refunds
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "refunds" (
    "id"                   TEXT              NOT NULL,
    "school_id"            TEXT              NOT NULL,
    "payment_id"           TEXT              NOT NULL,
    "amount"               INTEGER           NOT NULL,
    "reason"               TEXT              NOT NULL,
    "status"               "RefundStatus"    NOT NULL,
    "paystack_refund_ref"  TEXT,
    "processed_by"         TEXT              NOT NULL,
    "created_at"           TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id")
        REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "refunds_school_id_payment_id_idx" ON "refunds"("school_id", "payment_id");

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — tenant isolation
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "refunds" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "refunds" FORCE  ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "refunds"
    USING      (school_id::text = current_setting('app.current_school_id', true))
    WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
