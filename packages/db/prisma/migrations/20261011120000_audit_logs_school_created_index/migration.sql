-- The (school_id, created_at) index on audit_logs, missing since 2026-06-28.
--
-- 20260628000000_phase_3_slice_3_audit_partitioning meant to create it on the
-- new partitioned table with `CREATE INDEX IF NOT EXISTS
-- audit_logs_school_id_created_at_idx`. At that moment the OLD table, renamed
-- to audit_logs_old, still held an index of exactly that name (from the init
-- migration), so IF NOT EXISTS skipped the statement; the old table, and its
-- index, were then dropped. Every per-school audit read (the school's own
-- audit views, the platform admin's audit log) has scanned every monthly
-- partition since. Found 2026-10-08 by `prisma migrate diff` against a
-- migrated database (docs/deferred.md, "schema.prisma vs migration drift").
--
-- Created on the partitioned parent, which builds the index on every existing
-- partition and on each future one. CONCURRENTLY is not available for a
-- partitioned parent; audit_logs is small at pilot scale, so the brief write
-- lock is acceptable.
CREATE INDEX IF NOT EXISTS audit_logs_school_id_created_at_idx
  ON audit_logs (school_id, created_at);
