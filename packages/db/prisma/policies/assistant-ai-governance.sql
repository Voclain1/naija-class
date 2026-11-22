-- School AI terms decisions: tenant isolation (applied in 20261222120000_assistant_ai_governance).
-- ai_release_events is platform-level (no school_id), append-only for app_user.
ALTER TABLE school_ai_terms_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_ai_terms_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON school_ai_terms_events
  USING (school_id = current_setting('app.current_school_id', true))
  WITH CHECK (school_id = current_setting('app.current_school_id', true));
REVOKE UPDATE, DELETE ON ai_release_events FROM app_user;
REVOKE UPDATE ON school_ai_terms_events FROM app_user;
