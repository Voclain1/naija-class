-- Assistant voice sessions: tenant isolation (applied in 20261221120000_assistant_voice_sessions).
ALTER TABLE assistant_voice_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_voice_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON assistant_voice_sessions
  USING (school_id = current_setting('app.current_school_id', true))
  WITH CHECK (school_id = current_setting('app.current_school_id', true));
