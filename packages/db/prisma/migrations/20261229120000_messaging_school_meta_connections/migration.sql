CREATE TABLE messaging_meta_signup_sessions (
    school_id TEXT PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE ON UPDATE CASCADE,
    owner_id TEXT NOT NULL,
    state_hash TEXT NOT NULL,
    expires_at TIMESTAMP(3) NOT NULL,
    claimed_at TIMESTAMP(3)
);

CREATE TABLE messaging_school_meta_connections (
    school_id TEXT PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE ON UPDATE CASCADE,
    waba_id TEXT NOT NULL UNIQUE,
    phone_number_id TEXT NOT NULL UNIQUE,
    encrypted_token TEXT,
    connected_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    disconnected_at TIMESTAMP(3),
    activation_pending BOOLEAN NOT NULL DEFAULT FALSE,
    revoked_at TIMESTAMP(3)
);

ALTER TABLE messaging_meta_signup_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE messaging_meta_signup_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON messaging_meta_signup_sessions
    USING (school_id = current_setting('app.current_school_id', true))
    WITH CHECK (school_id = current_setting('app.current_school_id', true));

ALTER TABLE messaging_school_meta_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE messaging_school_meta_connections FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON messaging_school_meta_connections
    USING (school_id = current_setting('app.current_school_id', true))
    WITH CHECK (school_id = current_setting('app.current_school_id', true));

-- The inbox still routes globally by opaque provider identifiers. Restrict
-- all directory mutations to the calling tenant.
ALTER TABLE messaging_meta_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE messaging_meta_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY routing_lookup ON messaging_meta_accounts FOR SELECT USING (true);
CREATE POLICY tenant_insert ON messaging_meta_accounts FOR INSERT
    WITH CHECK (school_id = current_setting('app.current_school_id', true));
CREATE POLICY tenant_update ON messaging_meta_accounts FOR UPDATE
    USING (school_id = current_setting('app.current_school_id', true))
    WITH CHECK (school_id = current_setting('app.current_school_id', true));
CREATE POLICY tenant_delete ON messaging_meta_accounts FOR DELETE
    USING (school_id = current_setting('app.current_school_id', true));
GRANT INSERT, UPDATE ON messaging_meta_accounts TO app_user;
