CREATE TABLE messaging_wallet_entries (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
    reference TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('TOP_UP', 'RESERVE', 'SETTLE', 'RELEASE')),
    amount_kobo INTEGER NOT NULL CHECK (amount_kobo > 0),
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (school_id, kind, reference)
);

CREATE INDEX messaging_wallet_history_idx ON messaging_wallet_entries (school_id, created_at DESC, id DESC);

CREATE UNIQUE INDEX messaging_wallet_one_resolution
    ON messaging_wallet_entries (school_id, reference) WHERE kind IN ('SETTLE', 'RELEASE');
CREATE UNIQUE INDEX messaging_wallet_one_provider_top_up
    ON messaging_wallet_entries (reference) WHERE kind = 'TOP_UP';

ALTER TABLE messaging_wallet_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE messaging_wallet_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON messaging_wallet_entries
    USING (school_id = current_setting('app.current_school_id', true))
    WITH CHECK (school_id = current_setting('app.current_school_id', true));

CREATE FUNCTION preserve_messaging_wallet_entry() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Messaging wallet entries are immutable';
END;
$$;

CREATE TRIGGER messaging_wallet_entry_immutable
    BEFORE UPDATE OR DELETE ON messaging_wallet_entries
    FOR EACH ROW EXECUTE FUNCTION preserve_messaging_wallet_entry();
