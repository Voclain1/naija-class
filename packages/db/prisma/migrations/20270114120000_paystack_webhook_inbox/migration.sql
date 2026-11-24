-- Pre-tenant, authenticated Paystack inbox. Stores a restricted routing
-- projection, never the original webhook body, customer, bank or card data.
CREATE TABLE paystack_webhook_inbox (
    mode TEXT NOT NULL CHECK (mode IN ('live', 'test', 'legacy')),
    event_key TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload JSONB,
    attempts INTEGER NOT NULL DEFAULT 0,
    received_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    next_attempt_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    claim_id TEXT,
    claimed_until TIMESTAMP(3),
    processed_at TIMESTAMP(3),
    dead_at TIMESTAMP(3),
    PRIMARY KEY (mode, event_key)
);
CREATE INDEX paystack_inbox_due_idx ON paystack_webhook_inbox (mode, next_attempt_at)
    WHERE processed_at IS NULL AND dead_at IS NULL;
