ALTER TABLE messaging_wallet_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE messaging_wallet_entries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON messaging_wallet_entries;
CREATE POLICY tenant_isolation ON messaging_wallet_entries
    USING (school_id = current_setting('app.current_school_id', true))
    WITH CHECK (school_id = current_setting('app.current_school_id', true));
