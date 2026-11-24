CREATE TABLE messaging_wallet_top_ups (
    reference TEXT PRIMARY KEY,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
    client_request_id TEXT NOT NULL,
    created_by TEXT NOT NULL,
    amount_kobo INTEGER NOT NULL CHECK (amount_kobo > 0),
    checkout_url TEXT,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (school_id, client_request_id)
);

ALTER TABLE messaging_wallet_top_ups ENABLE ROW LEVEL SECURITY;
ALTER TABLE messaging_wallet_top_ups FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON messaging_wallet_top_ups
    USING (school_id = current_setting('app.current_school_id', true))
    WITH CHECK (school_id = current_setting('app.current_school_id', true));
