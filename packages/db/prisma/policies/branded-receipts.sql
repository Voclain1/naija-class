-- Branded receipts RLS policies (docs/modules/branded-receipts.md). Same
-- discipline as phase-*.sql: ENABLE + FORCE, WITH CHECK on every tenant
-- policy. Source of truth; migration 20260922120000_receipt_sequences copies
-- this block verbatim.

ALTER TABLE "receipt_sequences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "receipt_sequences" FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON receipt_sequences
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
