-- scripts/prune-smoke-schools.sql
--
-- Delete smoke test schools and all their tenant data.
-- Run as the school_kit migration role (bypasses RLS and has DROP/DELETE rights).
--
--   pnpm db:prune-smoke
--
-- Or directly:
--   psql "$DIRECT_URL" -f scripts/prune-smoke-schools.sql
--
-- Smoke schools: any school whose slug matches 'smoke-%' (created by scripts/smoke-test.sh).
-- Safe to run repeatedly — exits cleanly if no smoke schools exist.
-- Staging cleanup: run against STAGING_DIRECT_URL after smoke runs accumulate.

DO $$
DECLARE
  smoke_ids  TEXT[];
  smoke_uids TEXT[];
  rec        RECORD;
  n          BIGINT;
BEGIN
  SELECT ARRAY_AGG(id) INTO smoke_ids
  FROM schools WHERE slug LIKE 'smoke-%';

  IF smoke_ids IS NULL OR array_length(smoke_ids, 1) = 0 THEN
    RAISE NOTICE 'No smoke schools found — nothing to prune.';
    RETURN;
  END IF;

  RAISE NOTICE 'Pruning % smoke school(s)...', array_length(smoke_ids, 1);

  -- Collect user IDs before deleting users so we can clean up sessions
  -- (sessions store user_id, not school_id).
  SELECT ARRAY_AGG(id) INTO smoke_uids
  FROM users WHERE school_id = ANY(smoke_ids);

  -- Disable FK trigger checks for this transaction.
  -- Requires the school_kit (superuser) role; app_user would be denied.
  -- This lets us delete in any order without satisfying every FK chain manually.
  SET LOCAL session_replication_role = 'replica';

  -- Sessions: keyed by user_id, no school_id column.
  IF smoke_uids IS NOT NULL AND array_length(smoke_uids, 1) > 0 THEN
    DELETE FROM sessions WHERE user_id = ANY(smoke_uids);
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN RAISE NOTICE '  sessions                       : % row(s)', n; END IF;
  END IF;

  -- All other tables with a school_id column — found dynamically so this
  -- query survives new migrations without requiring manual updates here.
  FOR rec IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_name = c.table_name AND t.table_schema = c.table_schema
    WHERE c.table_schema = 'public'
      AND c.column_name = 'school_id'
      AND c.table_name  != 'schools'
      AND t.table_type   = 'BASE TABLE'
    ORDER BY c.table_name
  LOOP
    EXECUTE format(
      'DELETE FROM %I WHERE school_id = ANY($1)',
      rec.table_name
    ) USING smoke_ids;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN
      RAISE NOTICE '  %-30s : % row(s)', rec.table_name, n;
    END IF;
  END LOOP;

  -- Finally, the schools themselves.
  DELETE FROM schools WHERE id = ANY(smoke_ids);
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '  schools                        : % row(s)', n;

  RAISE NOTICE 'Prune complete.';
END $$;
