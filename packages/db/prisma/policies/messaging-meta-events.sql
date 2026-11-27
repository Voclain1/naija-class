ALTER TABLE messaging_meta_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE messaging_meta_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON messaging_meta_events;
CREATE POLICY tenant_isolation ON messaging_meta_events
    USING (school_id = current_setting('app.current_school_id', true))
    WITH CHECK (school_id = current_setting('app.current_school_id', true));
