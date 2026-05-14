-- Phase 0 RLS policies. Applied as a Prisma migration (see prisma/migrations).
-- Tenancy is enforced at the Postgres layer: every authenticated request sets
-- `app.current_school_id` via set_config(..., true) inside a transaction (see
-- packages/db/src/tenant-client.ts → withTenant).
--
-- Two design choices worth knowing:
--   1. FORCE ROW LEVEL SECURITY — by default RLS does NOT apply to a table's
--      owner. Our dev role IS the table owner, and a future operator role
--      might be too. FORCE makes RLS apply to everyone. The only escape hatch
--      is a SUPERUSER role or BYPASSRLS, which we deliberately don't grant to
--      the app role.
--   2. WITH CHECK on every policy — USING filters what the policy LETS YOU SEE
--      on reads/updates/deletes; WITH CHECK filters what NEW rows you can
--      INSERT (or UPDATE into). Without WITH CHECK, a buggy controller could
--      insert a row with someone else's school_id and RLS wouldn't stop it.
--
-- Tables NOT under RLS, deliberately:
--   - schools — filtered at the API layer by user ownership.
--   - roles   — system roles (is_system=true) are shared across tenants;
--               per-school custom roles are filtered by school_id at the API.

ALTER TABLE branches    ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches    FORCE  ROW LEVEL SECURITY;
ALTER TABLE users       ENABLE ROW LEVEL SECURITY;
ALTER TABLE users       FORCE  ROW LEVEL SECURITY;
ALTER TABLE user_roles  ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles  FORCE  ROW LEVEL SECURITY;
ALTER TABLE sessions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions    FORCE  ROW LEVEL SECURITY;
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations FORCE  ROW LEVEL SECURITY;
ALTER TABLE audit_logs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs  FORCE  ROW LEVEL SECURITY;

-- Direct school_id columns -------------------------------------------------

CREATE POLICY tenant_isolation ON branches
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

CREATE POLICY tenant_isolation ON users
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

CREATE POLICY tenant_isolation ON invitations
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

-- audit_logs allows nulls (system actions before a school exists). When
-- school_id IS NULL we let the row through; otherwise we tenant-check.
CREATE POLICY tenant_isolation ON audit_logs
  USING      (school_id IS NULL OR school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id IS NULL OR school_id::text = current_setting('app.current_school_id', true));

-- Joined-through-users tables ---------------------------------------------

CREATE POLICY tenant_isolation ON user_roles
  USING (EXISTS (
    SELECT 1 FROM users
    WHERE users.id = user_roles.user_id
      AND users.school_id::text = current_setting('app.current_school_id', true)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM users
    WHERE users.id = user_roles.user_id
      AND users.school_id::text = current_setting('app.current_school_id', true)
  ));

CREATE POLICY tenant_isolation ON sessions
  USING (EXISTS (
    SELECT 1 FROM users
    WHERE users.id = sessions.user_id
      AND users.school_id::text = current_setting('app.current_school_id', true)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM users
    WHERE users.id = sessions.user_id
      AND users.school_id::text = current_setting('app.current_school_id', true)
  ));
