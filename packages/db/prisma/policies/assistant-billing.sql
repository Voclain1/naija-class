ALTER TABLE assistant_billing_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_billing_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON assistant_billing_runs
  USING (school_id = current_setting('app.current_school_id', true))
  WITH CHECK (school_id = current_setting('app.current_school_id', true));
