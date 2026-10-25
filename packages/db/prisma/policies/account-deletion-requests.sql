-- Account deletion requests (2026-10-24). Applied by migration
-- 20261119120000_smart_import_beta_and_deletion_requests; kept here with the
-- other policy files.
ALTER TABLE "account_deletion_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "account_deletion_requests" FORCE  ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "account_deletion_requests"
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
