CREATE TABLE messaging_termii_events (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE ON UPDATE CASCADE,
    account_id TEXT NOT NULL,
    report_id TEXT NOT NULL,
    provider_ref TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('SENT', 'DELIVERED', 'FAILED')),
    received_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP(3),
    CONSTRAINT messaging_termii_event_dedup UNIQUE (school_id, account_id, report_id, provider_ref, state)
);
CREATE INDEX messaging_termii_events_pending_idx ON messaging_termii_events (school_id, processed_at, received_at);
ALTER TABLE messaging_termii_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE messaging_termii_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON messaging_termii_events
    USING (school_id = current_setting('app.current_school_id', true))
    WITH CHECK (school_id = current_setting('app.current_school_id', true));
