-- scripts/prune-smoke-schools.sql
--
-- Delete smoke test schools and all their tenant data.
-- Run as the school_kit migration role (bypasses RLS, owns the tables).
--
--   pnpm db:prune-smoke
--
-- Or directly:
--   psql "$DIRECT_URL" -f scripts/prune-smoke-schools.sql
--
-- Also safe to paste whole into a hosted SQL console (Neon's SQL Editor,
-- etc.) — it is a single DO block with no psql meta-commands.
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
--
-- ---------------------------------------------------------------------------
-- WHY THERE IS NO `SET session_replication_role = 'replica'` HERE (2026-08-09)
-- ---------------------------------------------------------------------------
-- This script used to disable FK trigger checks that way and delete tables in
-- alphabetical order. That works on a local Postgres where the migration role
-- is a real SUPERUSER — and fails on Neon, which is where production lives:
--
--   ERROR: permission denied to set parameter "session_replication_role"
--          (SQLSTATE 42501)
--
-- That is NOT a pooling artifact and NOT a misconfigured role. `session_
-- replication_role` is a PGC_SUSET parameter, and **Neon has no superuser at
-- all** — `neon_superuser` is a curated role that deliberately excludes it.
-- A direct (non-pooled) connection string does not help, and neither does
-- `SET ROLE`. Confirmed against Neon's own docs and their community thread on
-- `pg_restore --disable-triggers` failing for exactly this reason.
--
-- So this version never disables FK enforcement. Instead it deletes in a
-- computed **child-before-parent** order, derived from pg_constraint at run
-- time (so it still survives new migrations without manual edits here).
--
-- Deleting in a wrong order is a real hazard, not a theoretical one. Five FKs
-- in this schema are RESTRICT rather than CASCADE — assessment_scores→
-- grading_components, fee_items→fee_categories, payment_plans→invoices,
-- payments→invoices, refunds→payments — and alphabetical order gets four of
-- the five backwards. Demonstrated, not assumed: giving a smoke school one
-- fee category + one fee item and running the old alphabetical loop with FK
-- checks on produces
--
--   ERROR: update or delete on table "fee_categories" violates foreign key
--          constraint "fee_items_category_id_fkey" on table "fee_items"
--
-- while this ordered version deletes fee_items first and completes. The old
-- loop only ever "worked" because FK enforcement was switched off.
--
-- Honest caveat: for the shape production actually holds today (bare smoke
-- schools — one owner user plus the signup-seeded academic structure, no
-- finance rows), alphabetical order happens to work too, verified locally.
-- The ordering is therefore defensive for the current backlog and load-
-- bearing for anything richer — which matters because this runs unattended
-- on every deploy from here on.
--
-- Tables with no `school_id` (`sessions`, `user_roles`, `guardian_sessions`)
-- need no special handling: every one of their FKs into tenant data is
-- ON DELETE CASCADE (verified 2026-08-09), so they clear automatically when
-- `users` / `guardians` go. The explicit `sessions` delete below is kept as
-- belt-and-braces and is a no-op in practice.

DO $$
DECLARE
  smoke_ids  TEXT[];
  smoke_uids TEXT[];
  rec        RECORD;
  n          BIGINT;
  total      BIGINT := 0;
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

  IF smoke_uids IS NOT NULL AND array_length(smoke_uids, 1) > 0 THEN
    DELETE FROM sessions WHERE user_id = ANY(smoke_uids);
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN
      RAISE NOTICE '  % : % row(s)', rpad('sessions', 30), n;
      total := total + n;
    END IF;
  END IF;

  -- Every table with a school_id column, ordered CHILD-BEFORE-PARENT.
  --
  -- depth(child) = depth(parent) + 1 over the FK graph, so descending depth
  -- deletes dependents first and never trips a FK check. Self-referencing FKs
  -- are ignored (a table cannot need deleting before itself) and the path
  -- accumulator guards against a cycle causing infinite recursion.
  --
  -- Declarative partitions are excluded: deleting from the partitioned parent
  -- (e.g. audit_logs) already removes their rows, and listing both would
  -- double-count.
  FOR rec IN
    WITH RECURSIVE fk AS (
      SELECT c.conrelid::regclass::text AS child,
             c.confrelid::regclass::text AS parent
      FROM pg_constraint c
      JOIN pg_namespace n2 ON n2.oid = c.connamespace
      WHERE c.contype = 'f'
        AND n2.nspname = 'public'
        AND c.conrelid <> c.confrelid
    ),
    tbl AS (
      SELECT t.table_name::text AS name
      FROM information_schema.tables t
      JOIN information_schema.columns col
        ON col.table_schema = t.table_schema
       AND col.table_name  = t.table_name
       AND col.column_name = 'school_id'
      WHERE t.table_schema = 'public'
        AND t.table_type   = 'BASE TABLE'
        AND t.table_name  <> 'schools'
        AND t.table_name NOT IN (
          SELECT i.inhrelid::regclass::text FROM pg_inherits i
        )
    ),
    depth AS (
      SELECT name, 0 AS d, ARRAY[name] AS path FROM tbl
      UNION ALL
      SELECT f.child, dep.d + 1, dep.path || f.child
      FROM fk f
      JOIN depth dep ON dep.name = f.parent
      WHERE f.child IN (SELECT name FROM tbl)
        AND NOT f.child = ANY(dep.path)
        AND dep.d < 25
    )
    SELECT name, max(d) AS delete_depth
    FROM depth
    GROUP BY name
    ORDER BY max(d) DESC, name
  LOOP
    EXECUTE format(
      'DELETE FROM %I WHERE school_id = ANY($1)',
      rec.name
    ) USING smoke_ids;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN
      RAISE NOTICE '  % : % row(s)', rpad(rec.name, 30), n;
      total := total + n;
    END IF;
  END LOOP;

  -- Finally, the schools themselves.
  DELETE FROM schools WHERE id = ANY(smoke_ids);
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '  % : % row(s)', rpad('schools', 30), n;
  total := total + n;

  RAISE NOTICE 'Prune complete — % row(s) deleted in total.', total;
END $$;
