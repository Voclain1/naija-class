ALTER TABLE notification_deliveries
    ADD COLUMN dispatch_state TEXT,
    ADD COLUMN dispatch_claimed_at TIMESTAMP(3),
    ADD COLUMN dispatch_reason TEXT,
    ADD COLUMN dispatch_rate_version TEXT,
    ADD COLUMN dispatch_estimate_kobo INTEGER;
CREATE INDEX notification_deliveries_dispatch_idx ON notification_deliveries (school_id, dispatch_state, sent_at);
