-- Platform-authored snapshots. Scope is 'platform' for managed legacy rates and
-- the internal school ID for tenant-owned configuration. Never store credentials.
CREATE TABLE messaging_review_revisions (
    revision BIGSERIAL PRIMARY KEY,
    scope TEXT NOT NULL,
    review_key TEXT NOT NULL,
    snapshot JSONB NOT NULL,
    actor_id TEXT NOT NULL,
    evidence_ref TEXT NOT NULL CHECK (length(evidence_ref) BETWEEN 1 AND 120),
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX messaging_review_latest_idx ON messaging_review_revisions(scope, review_key, revision DESC);
REVOKE UPDATE, DELETE, TRUNCATE ON messaging_review_revisions FROM app_user;
GRANT USAGE ON SEQUENCE messaging_review_revisions_revision_seq TO app_user;
