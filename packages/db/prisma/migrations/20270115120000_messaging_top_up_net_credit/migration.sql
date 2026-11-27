ALTER TABLE messaging_wallet_top_ups
    ADD COLUMN estimated_fee_kobo INTEGER CHECK (estimated_fee_kobo >= 0),
    ADD COLUMN actual_fee_kobo INTEGER CHECK (actual_fee_kobo >= 0),
    ADD COLUMN reconciliation_code TEXT,
    ADD COLUMN verified_at TIMESTAMP(3);
