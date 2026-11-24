CREATE TABLE messaging_reminder_frequency (
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE ON UPDATE CASCADE,
    student_id TEXT NOT NULL,
    guardian_id TEXT NOT NULL,
    campaign_id TEXT NOT NULL,
    attempted_at TIMESTAMP(3) NOT NULL,
    PRIMARY KEY (school_id, student_id, guardian_id)
);
ALTER TABLE messaging_reminder_frequency ENABLE ROW LEVEL SECURITY;
ALTER TABLE messaging_reminder_frequency FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON messaging_reminder_frequency
    USING (school_id = current_setting('app.current_school_id', true))
    WITH CHECK (school_id = current_setting('app.current_school_id', true));
