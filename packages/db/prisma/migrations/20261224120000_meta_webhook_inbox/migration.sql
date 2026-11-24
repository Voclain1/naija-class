-- Directory contains only provider IDs and the owning tenant. Provisioning
-- requires a verified WABA/phone ownership binding.
CREATE TABLE messaging_meta_accounts (
    school_id TEXT PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE ON UPDATE CASCADE,
    waba_id TEXT NOT NULL,
    phone_number_id TEXT NOT NULL UNIQUE,
    CHECK (waba_id ~ '^[0-9]{1,32}$' AND phone_number_id ~ '^[0-9]{1,32}$')
);

-- App workers may read or delete an existing binding. Provisioning is
-- privileged until verified Embedded Signup owns the insert/update path.
REVOKE INSERT, UPDATE ON messaging_meta_accounts FROM app_user;

CREATE TABLE messaging_meta_events (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE ON UPDATE CASCADE,
    waba_id TEXT NOT NULL,
    phone_number_id TEXT NOT NULL,
    provider_ref TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('SENT', 'DELIVERED', 'READ', 'FAILED')),
    occurred_at TIMESTAMP(3) NOT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP(3),
    CONSTRAINT messaging_meta_events_dedup_key UNIQUE (school_id, waba_id, phone_number_id, provider_ref, state, occurred_at)
);
CREATE INDEX messaging_meta_events_pending_idx ON messaging_meta_events (school_id, processed_at, created_at);

ALTER TABLE messaging_meta_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE messaging_meta_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON messaging_meta_events
    USING (school_id = current_setting('app.current_school_id', true))
    WITH CHECK (school_id = current_setting('app.current_school_id', true));

ALTER TABLE notification_deliveries
    ADD COLUMN provider_ref TEXT,
    ADD COLUMN provider_account_id TEXT,
    ADD COLUMN provider_state TEXT,
    ADD COLUMN provider_state_at TIMESTAMP(3);
CREATE UNIQUE INDEX notification_deliveries_provider_ref_idx
    ON notification_deliveries (school_id, provider_account_id, provider_ref);
