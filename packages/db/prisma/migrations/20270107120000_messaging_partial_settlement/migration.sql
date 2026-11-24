-- A settlement is terminal and stores the actual charge plus any unused hold.
-- Historical full settlements retain a zero release. Ledger rows are append-only.
ALTER TABLE messaging_wallet_entries
    ADD COLUMN released_kobo INTEGER NOT NULL DEFAULT 0,
    ADD CONSTRAINT messaging_wallet_release_requires_settlement
        CHECK (released_kobo >= 0 AND (released_kobo = 0 OR kind = 'SETTLE'));
