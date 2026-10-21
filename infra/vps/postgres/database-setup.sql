-- Database-level setup for School Kit (docs/runbooks/vps-migration.md).
-- Run as `postgres` on a new, empty database: by initdb/10-roles.sh on first
-- start, and by vps-db-copy.yml before each restore. Roles are cluster-wide
-- and created once, by 10-roles.sh.
--   school_kit — migrations, owner of every table and SECURITY DEFINER
--                function; BYPASSRLS (pre-tenant auth lookups need it).
--   app_user   — the running API: DML only, never SUPERUSER or BYPASSRLS, so
--                FORCE ROW LEVEL SECURITY binds it (CLAUDE.md hard rule).
\set ON_ERROR_STOP on
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

-- The raw pgcrypto primitives are callable only through encrypt_bvn /
-- decrypt_bvn (SECURITY DEFINER, owned by school_kit). Migration
-- 20260708010000 revokes them from PUBLIC, but only the extension's owner can,
-- and that is `postgres` here, so it is done here, as `postgres`.
-- security-definer-inventory.spec.ts checks it.
REVOKE ALL ON FUNCTION pgp_sym_encrypt(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION pgp_sym_encrypt(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION pgp_sym_decrypt(bytea, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION pgp_sym_decrypt(bytea, text, text) FROM PUBLIC;
-- encrypt_bvn / decrypt_bvn run as school_kit and call the primitives.
GRANT EXECUTE ON FUNCTION pgp_sym_encrypt(text, text), pgp_sym_encrypt(text, text, text),
  pgp_sym_decrypt(bytea, text), pgp_sym_decrypt(bytea, text, text) TO school_kit;

GRANT CREATE, USAGE ON SCHEMA public TO school_kit;
SELECT format('GRANT CONNECT ON DATABASE %I TO app_user', current_database()) \gexec
GRANT USAGE ON SCHEMA public TO app_user;

-- Tables school_kit creates later (migrations) grant themselves to app_user.
ALTER DEFAULT PRIVILEGES FOR ROLE school_kit IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE school_kit IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;
