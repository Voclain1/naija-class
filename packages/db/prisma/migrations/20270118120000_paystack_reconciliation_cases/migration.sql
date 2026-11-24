CREATE TABLE paystack_payment_exceptions (
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
    reference TEXT NOT NULL,
    reason TEXT NOT NULL,
    invoice_id TEXT NOT NULL,
    expected_kobo INTEGER,
    observed_kobo BIGINT,
    observed_currency TEXT,
    unapplied_kobo INTEGER,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (school_id, reference, reason)
);
ALTER TABLE paystack_payment_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE paystack_payment_exceptions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON paystack_payment_exceptions
    USING (school_id = current_setting('app.current_school_id', true))
    WITH CHECK (school_id = current_setting('app.current_school_id', true));

ALTER TABLE messaging_wallet_top_ups
    ADD COLUMN recovery_attempts INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN next_recovery_at TIMESTAMP(3);
