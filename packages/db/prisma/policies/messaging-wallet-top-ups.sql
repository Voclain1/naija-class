ALTER TABLE messaging_wallet_top_ups ENABLE ROW LEVEL SECURITY;
ALTER TABLE messaging_wallet_top_ups FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON messaging_wallet_top_ups;
CREATE POLICY tenant_isolation ON messaging_wallet_top_ups
    USING (school_id = current_setting('app.current_school_id', true))
    WITH CHECK (school_id = current_setting('app.current_school_id', true));
