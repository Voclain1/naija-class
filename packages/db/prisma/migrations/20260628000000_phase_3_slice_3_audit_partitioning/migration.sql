-- Phase 3 / Slice 3 — Audit-log partitioning
--
-- Converts audit_logs from a plain heap table to a PARTITION BY RANGE
-- (created_at) table with monthly child partitions. Pre-creates partitions
-- from 2026-05 (earliest data) through 2027-09 (15 months forward) plus a
-- default catch-all partition so inserts never fail if the cron job lags.
--
-- PRIMARY KEY change: PostgreSQL requires that all unique constraints on a
-- partitioned table include every partition-key column. Since we partition by
-- created_at, the PK becomes (id, created_at) instead of (id) alone.
-- audit_logs has no FK references from any other table, so this is safe.
--
-- PROD SAFETY (prod is live at school-kit-api.fly.dev with smoke-test data):
-- The migration runs in two phases to minimise lock time on audit_logs:
--
--   Phase A–C  Build the partitioned table and copy all rows.
--              No lock is held on audit_logs during the copy.
--              audit_logs remains fully readable and writable.
--
--   Phase D    Atomic swap: LOCK audit_logs (ACCESS EXCLUSIVE), copy any rows
--              written since Phase C started (delta), then rename old → new.
--              Lock is held only for the two RENAME statements and the delta
--              INSERT. With smoke-test data volume this is single-digit ms.
--              Any concurrent write that sees the lock retries automatically
--              after COMMIT.
--
--   Phase E    Apply RLS on the new parent table.
--              RLS on the partitioned parent propagates to all child partitions
--              for queries through the parent. The app never queries child
--              partitions directly, so no per-partition policy is needed.
--
--   Phase F    Drop the old (now-renamed) table.

-- ─────────────────────────────────────────────────────────────────────────────
-- Phase A: create the partitioned parent table
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE audit_logs_new (
  "id"          TEXT          NOT NULL,
  "school_id"   TEXT,
  "user_id"     TEXT,
  "action"      TEXT          NOT NULL,
  "entity_type" TEXT,
  "entity_id"   TEXT,
  "metadata"    JSONB,
  "ip_address"  TEXT,
  "created_at"  TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Composite PK required by Postgres: partition key must be part of every
  -- unique constraint. (id) alone would be rejected on a partitioned table.
  CONSTRAINT audit_logs_new_pkey PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- Phase B: pre-create monthly partitions
-- ─────────────────────────────────────────────────────────────────────────────

-- Historical partitions (smoke-test data starts 2026-05)
CREATE TABLE audit_logs_2026_05 PARTITION OF audit_logs_new FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE audit_logs_2026_06 PARTITION OF audit_logs_new FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE audit_logs_2026_07 PARTITION OF audit_logs_new FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE audit_logs_2026_08 PARTITION OF audit_logs_new FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE audit_logs_2026_09 PARTITION OF audit_logs_new FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE audit_logs_2026_10 PARTITION OF audit_logs_new FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE audit_logs_2026_11 PARTITION OF audit_logs_new FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE audit_logs_2026_12 PARTITION OF audit_logs_new FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');

-- Future partitions (15 months forward)
CREATE TABLE audit_logs_2027_01 PARTITION OF audit_logs_new FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');
CREATE TABLE audit_logs_2027_02 PARTITION OF audit_logs_new FOR VALUES FROM ('2027-02-01') TO ('2027-03-01');
CREATE TABLE audit_logs_2027_03 PARTITION OF audit_logs_new FOR VALUES FROM ('2027-03-01') TO ('2027-04-01');
CREATE TABLE audit_logs_2027_04 PARTITION OF audit_logs_new FOR VALUES FROM ('2027-04-01') TO ('2027-05-01');
CREATE TABLE audit_logs_2027_05 PARTITION OF audit_logs_new FOR VALUES FROM ('2027-05-01') TO ('2027-06-01');
CREATE TABLE audit_logs_2027_06 PARTITION OF audit_logs_new FOR VALUES FROM ('2027-06-01') TO ('2027-07-01');
CREATE TABLE audit_logs_2027_07 PARTITION OF audit_logs_new FOR VALUES FROM ('2027-07-01') TO ('2027-08-01');
CREATE TABLE audit_logs_2027_08 PARTITION OF audit_logs_new FOR VALUES FROM ('2027-08-01') TO ('2027-09-01');
CREATE TABLE audit_logs_2027_09 PARTITION OF audit_logs_new FOR VALUES FROM ('2027-09-01') TO ('2027-10-01');

-- Default partition: rows outside all named ranges land here instead of
-- failing. Protects against inserts that arrive before the monthly cron fires.
CREATE TABLE audit_logs_default PARTITION OF audit_logs_new DEFAULT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Phase C: copy existing rows (no lock on audit_logs)
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO audit_logs_new (
  id, school_id, user_id, action, entity_type,
  entity_id, metadata, ip_address, created_at
)
SELECT
  id, school_id, user_id, action, entity_type,
  entity_id, metadata, ip_address, created_at
FROM audit_logs;

-- ─────────────────────────────────────────────────────────────────────────────
-- Phase D: atomic swap
-- Prisma wraps the entire migration in one transaction, so no explicit
-- BEGIN/COMMIT is needed here. The LOCK acquires within that transaction and
-- is released at COMMIT (end of migration). The two RENAMEs are atomic
-- because they are part of the same transaction.
-- ─────────────────────────────────────────────────────────────────────────────

LOCK TABLE audit_logs IN ACCESS EXCLUSIVE MODE;

-- Delta: catch any rows written to audit_logs between Phase C and now.
-- ON CONFLICT DO NOTHING makes this safe to re-run if the migration retries.
INSERT INTO audit_logs_new (
  id, school_id, user_id, action, entity_type,
  entity_id, metadata, ip_address, created_at
)
SELECT
  id, school_id, user_id, action, entity_type,
  entity_id, metadata, ip_address, created_at
FROM audit_logs
WHERE created_at > (
  SELECT COALESCE(MAX(created_at), '1970-01-01'::TIMESTAMP) FROM audit_logs_new
)
ON CONFLICT (id, created_at) DO NOTHING;

ALTER TABLE audit_logs     RENAME TO audit_logs_old;
ALTER TABLE audit_logs_new RENAME TO audit_logs;

-- ─────────────────────────────────────────────────────────────────────────────
-- Phase E: RLS on the new partitioned parent
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE  ROW LEVEL SECURITY;

-- school_id IS NULL covers pre-tenant audit rows (e.g. signup, session lookup)
-- where no school context exists yet. Removing this arm would hide those rows
-- from app_user queries entirely, breaking audit reads for the signup flow.
CREATE POLICY tenant_isolation ON audit_logs
  USING      (school_id IS NULL OR school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id IS NULL OR school_id::text = current_setting('app.current_school_id', true));

-- Composite index mirrors the original @@index([schoolId, createdAt]).
-- Created on the parent; Postgres applies it automatically to all partitions.
CREATE INDEX IF NOT EXISTS audit_logs_school_id_created_at_idx
  ON audit_logs (school_id, created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- Phase F: drop the old table
-- ─────────────────────────────────────────────────────────────────────────────

DROP TABLE audit_logs_old;

-- ─────────────────────────────────────────────────────────────────────────────
-- Phase G: SECURITY DEFINER helper for runtime partition creation
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Why SECURITY DEFINER: CREATE TABLE requires privileges the runtime role
-- (app_user) deliberately does not hold. This function runs with the
-- privileges of its owner (the migration role, school_kit) so app_user can
-- pre-create monthly partitions via a simple SELECT call.
--
-- What it returns: VOID (no data leaked).
-- What it deliberately does NOT return: partition OID, existence flag, or any
-- row from audit_logs. The table name is derived entirely from validated
-- integer arithmetic and quoted with %I — never interpolated from caller input.

CREATE OR REPLACE FUNCTION create_audit_log_partition(p_year INT, p_month INT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_name  TEXT;
  v_from  DATE;
  v_to    DATE;
BEGIN
  -- Name is constructed from integer arithmetic only — %I quotes it safely.
  v_name := 'audit_logs_' || p_year || '_' || lpad(p_month::TEXT, 2, '0');
  v_from := make_date(p_year, p_month, 1);
  v_to   := v_from + INTERVAL '1 month';

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF audit_logs '
    'FOR VALUES FROM (%L::TIMESTAMP) TO (%L::TIMESTAMP)',
    v_name, v_from, v_to
  );
END;
$$;

REVOKE ALL ON FUNCTION create_audit_log_partition(INT, INT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION create_audit_log_partition(INT, INT) TO app_user;
