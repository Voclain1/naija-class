-- What vps-db-copy.yml compares between Neon and the VPS after a copy. Read
-- as school_kit on Neon (BYPASSRLS, so the counts are whole) and as postgres
-- on the VPS. Each line: name|value.
SELECT 'migrations', count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL
UNION ALL SELECT 'security_definer_functions', count(*) FROM pg_proc WHERE prosecdef
UNION ALL SELECT 'rls_forced_tables', count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relforcerowsecurity
UNION ALL SELECT 'schools', count(*) FROM schools
UNION ALL SELECT 'users', count(*) FROM users
UNION ALL SELECT 'students', count(*) FROM students
UNION ALL SELECT 'guardians', count(*) FROM guardians
UNION ALL SELECT 'invoices', count(*) FROM invoices
UNION ALL SELECT 'payments', count(*) FROM payments
UNION ALL SELECT 'audit_logs', count(*) FROM audit_logs
ORDER BY 1;
