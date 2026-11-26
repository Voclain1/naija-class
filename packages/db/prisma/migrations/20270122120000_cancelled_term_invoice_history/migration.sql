-- Sequence zero remains the unique current term slot. Only cancelled,
-- unpaid term history can move to a negative sequence; supplements stay positive.
-- No backfill: old cancellations are re-keyed only on successful regeneration.
ALTER TABLE "invoices"
  DROP CONSTRAINT "invoices_sequence_check",
  ADD CONSTRAINT "invoices_sequence_check"
    CHECK ("sequence" >= 0 OR ("status" = 'CANCELLED' AND "total_paid" = 0)) NOT VALID;
