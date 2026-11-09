-- Durable operational proposals only: no user request, reply or model text.
CREATE TABLE assistant_billing_runs (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  approved_by TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'COMPLETED')),
  payload JSONB NOT NULL,
  preview_hash TEXT NOT NULL,
  result JSONB,
  expires_at TIMESTAMP(3) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_at TIMESTAMP(3)
);
CREATE INDEX assistant_billing_runs_school_id_created_at_idx
  ON assistant_billing_runs (school_id, created_at DESC);
ALTER TABLE assistant_billing_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_billing_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON assistant_billing_runs
  USING (school_id = current_setting('app.current_school_id', true))
  WITH CHECK (school_id = current_setting('app.current_school_id', true));
