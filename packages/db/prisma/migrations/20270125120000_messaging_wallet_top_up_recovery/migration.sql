ALTER TABLE messaging_wallet_top_ups
    ADD COLUMN recovery_attempts INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN next_recovery_at TIMESTAMP(3);
