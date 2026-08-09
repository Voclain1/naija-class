-- scripts/list-smoke-schools.sql
--
-- READ-ONLY preview of exactly what scripts/prune-smoke-schools.sql would
-- delete. Runs no DELETE, opens no transaction that writes anything.
--
--   pnpm db:list-smoke
--
-- Or directly:
--   psql "$DIRECT_URL" -f scripts/list-smoke-schools.sql
--
-- ALWAYS run this before running the prune against production. The prune is
-- irreversible and there is no isolated staging tier to rehearse it on (see
-- CLAUDE.md "There is no isolated staging environment") — this preview IS the
-- rehearsal.
--
-- The predicate below MUST stay identical to the prune's. If you change one,
-- change both in the same commit.

\echo ''
\echo '=== Schools MATCHING the smoke-school predicate (these WOULD be deleted) ==='
SELECT
  s.slug,
  s.name,
  s.created_at,
  (SELECT count(*) FROM users    u WHERE u.school_id = s.id) AS users,
  (SELECT count(*) FROM students t WHERE t.school_id = s.id) AS students,
  (SELECT count(*) FROM invoices i WHERE i.school_id = s.id) AS invoices,
  (SELECT count(*) FROM payments p WHERE p.school_id = s.id) AS payments
FROM schools s
WHERE s.slug ~ '^smoke-[0-9]+$'
  AND EXISTS (
    SELECT 1 FROM users u
    WHERE u.school_id = s.id
      AND u.email LIKE '%@smoke-test.invalid'
  )
ORDER BY s.created_at;

\echo ''
\echo '=== Sanity check: any student/invoice/payment data above is a RED FLAG ==='
\echo '=== A genuine smoke school has 1 user and 0 of everything else.        ==='
\echo ''

\echo '=== Schools NOT matching, for contrast (these are SAFE / untouched) ==='
SELECT
  s.slug,
  s.name,
  s.created_at,
  (SELECT count(*) FROM students t WHERE t.school_id = s.id) AS students
FROM schools s
WHERE NOT (
  s.slug ~ '^smoke-[0-9]+$'
  AND EXISTS (
    SELECT 1 FROM users u
    WHERE u.school_id = s.id
      AND u.email LIKE '%@smoke-test.invalid'
  )
)
ORDER BY s.created_at;

\echo ''
\echo '=== Near-miss audit: slug starts with "smoke-" but is NOT matched.    ==='
\echo '=== Under the OLD `LIKE ''smoke-%''` predicate these would have been  ==='
\echo '=== DELETED. Expect zero rows; any row here is a school the old       ==='
\echo '=== predicate would have destroyed.                                   ==='
SELECT s.slug, s.name, s.created_at
FROM schools s
WHERE s.slug LIKE 'smoke-%'
  AND NOT (
    s.slug ~ '^smoke-[0-9]+$'
    AND EXISTS (
      SELECT 1 FROM users u
      WHERE u.school_id = s.id
        AND u.email LIKE '%@smoke-test.invalid'
    )
  )
ORDER BY s.created_at;
\echo ''
