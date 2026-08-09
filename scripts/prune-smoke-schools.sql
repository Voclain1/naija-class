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
-- WHAT COUNTS AS A SMOKE SCHOOL — deliberately narrow (tightened 2026-08-09,
-- when this script was wired into deploy-staging.yml to run automatically
-- against PRODUCTION on every deploy).
--
-- It previously matched `slug LIKE 'smoke-%'`. That was acceptable while this
-- was a manual, dev-only chore; it is NOT acceptable as an automated DELETE
-- against the production database, because RESERVED_SLUGS
-- (packages/types/src/auth/reserved-slugs.ts) is an exact-match set of 39
-- names that does not reserve `smoke` and does no prefix matching. A genuine
-- school signing up as `smoke-academy` would pass slug validation and then be
-- silently destroyed — students, invoices, payments and all — by the next
-- deploy. Nothing else in the system would have flagged it.
--
-- Two independent conditions must BOTH hold now, mirroring exactly what
-- scripts/smoke-test.sh op 3 creates and nothing else:
--   1. slug matches ^smoke-<digits>$        (the `smoke-<unix-timestamp>` form;
--      `smoke-academy` and every other word-suffixed slug no longer match)
--   2. the school has an owner user whose email ends in `@smoke-test.invalid`
--      (`.invalid` is an RFC 2606 reserved TLD — it can never be a deliverable
--      address, so no real signup can plausibly hold one)
--
-- Condition 2 is the real guarantee; condition 1 is the cheap index-friendly
-- filter. If you change the slug or email pattern in scripts/smoke-test.sh,
-- change it here in the same commit or cleanup silently stops working.
--
-- Safe to run repeatedly — exits cleanly if no smoke schools exist.

DO $$
DECLARE
  smoke_ids  TEXT[];
  smoke_uids TEXT[];
  rec        RECORD;
  n          BIGINT;
BEGIN
  SELECT ARRAY_AGG(s.id) INTO smoke_ids
  FROM schools s
  WHERE s.slug ~ '^smoke-[0-9]+$'
    AND EXISTS (
      SELECT 1 FROM users u
      WHERE u.school_id = s.id
        AND u.email LIKE '%@smoke-test.invalid'
    );

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
      -- rpad(), not '%-30s': PL/pgSQL's RAISE has no printf width specifiers.
      -- '%-30s' printed the table name followed by a literal "-30s" (observed
      -- as "users-30s : 1 row(s)"). Cosmetic, but this output now lands in the
      -- deploy log on every run, so it should be readable.
      RAISE NOTICE '  % : % row(s)', rpad(rec.table_name, 30), n;
    END IF;
  END LOOP;

  -- Finally, the schools themselves.
  DELETE FROM schools WHERE id = ANY(smoke_ids);
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '  schools                        : % row(s)', n;

  RAISE NOTICE 'Prune complete.';
END $$;
