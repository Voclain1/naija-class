CREATE TABLE messaging_inbound_messages (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE ON UPDATE CASCADE,
    guardian_id TEXT NOT NULL,
    provider_ref TEXT NOT NULL,
    encrypted_text TEXT NOT NULL,
    occurred_at TIMESTAMP(3) NOT NULL,
    expires_at TIMESTAMP(3) NOT NULL,
    UNIQUE (school_id, provider_ref)
);
CREATE INDEX messaging_inbound_history_idx ON messaging_inbound_messages (school_id, guardian_id, occurred_at DESC, id DESC);
CREATE INDEX messaging_inbound_expiry_idx ON messaging_inbound_messages (school_id, expires_at);
ALTER TABLE messaging_inbound_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE messaging_inbound_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON messaging_inbound_messages
    USING (school_id = current_setting('app.current_school_id', true))
    WITH CHECK (school_id = current_setting('app.current_school_id', true));
