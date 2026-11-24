-- Platform-owned controls. Each amendment is itself an immutable audit entry.
CREATE TABLE messaging_emergency_controls (
    revision BIGSERIAL PRIMARY KEY,
    channel TEXT NOT NULL CHECK (channel IN ('SMS', 'WHATSAPP')),
    stopped BOOLEAN NOT NULL,
    actor_id TEXT NOT NULL,
    evidence_ref TEXT NOT NULL CHECK (length(evidence_ref) BETWEEN 1 AND 120),
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX messaging_emergency_controls_latest_idx ON messaging_emergency_controls(channel, revision DESC);
REVOKE UPDATE, DELETE, TRUNCATE ON messaging_emergency_controls FROM app_user;
GRANT USAGE ON SEQUENCE messaging_emergency_controls_revision_seq TO app_user;
