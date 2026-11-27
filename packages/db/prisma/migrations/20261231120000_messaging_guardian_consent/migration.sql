ALTER TABLE messaging_school_meta_connections ADD COLUMN display_phone TEXT;
CREATE TABLE messaging_guardian_consents (
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE ON UPDATE CASCADE,
    guardian_id TEXT NOT NULL REFERENCES guardians(id) ON DELETE CASCADE ON UPDATE CASCADE,
    phone TEXT NOT NULL,
    consent_version TEXT NOT NULL,
    challenge_hash TEXT,
    challenge_expires_at TIMESTAMP(3),
    challenge_issued_at TIMESTAMP(3),
    verified_at TIMESTAMP(3),
    withdrawn_at TIMESTAMP(3),
    PRIMARY KEY (school_id, guardian_id)
);
CREATE INDEX messaging_guardian_consents_school_phone_idx ON messaging_guardian_consents (school_id, phone);
ALTER TABLE messaging_guardian_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE messaging_guardian_consents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON messaging_guardian_consents
    USING (school_id = current_setting('app.current_school_id', true))
    WITH CHECK (school_id = current_setting('app.current_school_id', true));
