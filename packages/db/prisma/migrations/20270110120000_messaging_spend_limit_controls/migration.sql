-- A scope of 'platform' is shared by all platform-funded Termii and school wallets.
-- Otherwise the scope is the internal school ID. Rows are immutable admin revisions.
CREATE TABLE messaging_spend_limit_revisions (
    revision BIGSERIAL PRIMARY KEY,
    scope TEXT NOT NULL,
    daily_kobo INTEGER CHECK (daily_kobo >= 0),
    actor_id TEXT NOT NULL,
    evidence_ref TEXT NOT NULL CHECK (length(evidence_ref) BETWEEN 1 AND 120),
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX messaging_spend_limit_latest_idx ON messaging_spend_limit_revisions(scope, revision DESC);
REVOKE UPDATE, DELETE, TRUNCATE ON messaging_spend_limit_revisions FROM app_user;
GRANT USAGE ON SEQUENCE messaging_spend_limit_revisions_revision_seq TO app_user;
