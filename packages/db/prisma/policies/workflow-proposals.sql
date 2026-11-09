-- Workflow proposals: tenant isolation (applied in 20261209120000_workflow_proposals).
ALTER TABLE workflow_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_proposals FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workflow_proposals
  USING (school_id = current_setting('app.current_school_id', true))
  WITH CHECK (school_id = current_setting('app.current_school_id', true));
