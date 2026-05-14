-- Create a non-privileged role for runtime application queries.
--
-- The POSTGRES_USER set by docker-compose (school_kit) is SUPERUSER and has
-- BYPASSRLS — both of which silently skip every RLS policy, even those with
-- FORCE ROW LEVEL SECURITY. That role is fine for running migrations, but a
-- runtime app must NEVER connect with privileges that bypass tenancy.
--
-- app_user has:
--   * LOGIN
--   * NO SUPERUSER, NO BYPASSRLS (this is the whole point)
--   * SELECT/INSERT/UPDATE/DELETE on all tables in public
--   * USAGE on schema public + sequences
--
-- Migrations connect as school_kit via DIRECT_URL; the runtime PrismaClient
-- connects as app_user via DATABASE_URL.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN PASSWORD 'app_user';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE school_kit TO app_user;
GRANT USAGE  ON SCHEMA public         TO app_user;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO app_user;
GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- Future tables (created by later migrations) get the same grants automatically.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES    TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT                  ON SEQUENCES TO app_user;
