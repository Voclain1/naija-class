-- Phase 4 / Slice 2 — Guardian portal auth.
--
-- Bundles the schema for Decisions A/B/C (docs/modules/phase-4.md §3/§4) and
-- the three SECURITY DEFINER lookup functions the guardian auth flow needs
-- pre-tenant. Mirrors the shape and discipline of 20260516000000_add_auth_
-- lookup_functions and 20260517000000_invitation_names_and_lookup — see
-- those files for the fuller chicken-and-egg rationale; this header only
-- covers what's specific to guardians.
--
-- IMPORTANT — this migration adds THREE new SECURITY DEFINER functions, not
-- two. The slice-2 plan-first anticipated auth_resolve_guardian_session and
-- auth_resolve_guardian_invitation_by_token_hash (mirroring staff's session
-- and invitation lookups). A third, auth_lookup_guardians_for_login, is also
-- required once slice 2 committed to the multi-candidate argon2-verify login
-- strategy (option ii, approved 2026-07-16) — see that function's own header
-- comment below for why. SD count moves 7 -> 10, not 7 -> 9. CLAUDE.md's
-- inventory table and apps/api/src/__tests__/security-definer-inventory.spec.ts
-- are updated in the same PR as this migration.
--
-- =========================================================================
-- 1. Schema changes
-- =========================================================================

-- ---- 1a. Guardian auth columns (Decision A) ----------------------------
-- All nullable except email_verified — every pre-Phase-4 guardian was never
-- invited, never logged in, which NULL/false both represent correctly with
-- no backfill required.
ALTER TABLE "guardians"
  ADD COLUMN "password_hash"     TEXT,
  ADD COLUMN "email_verified"    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "last_login_at"     TIMESTAMP(3),
  ADD COLUMN "portal_invited_at" TIMESTAMP(3);

-- ---- 1b. Guardian.email uniqueness, scoped per school (Decision C) -----
-- Pre-migration duplicate check run against local dev AND Neon production
-- (school-kit-prod, the only Neon project/branch that exists — see the
-- "staging environment" note in this PR's report): 0 rows in both. Safe to
-- add without a data-cleanup step.
CREATE UNIQUE INDEX "guardians_school_id_email_key" ON "guardians"("school_id", "email");

-- ---- 1c. guardian_sessions (mirrors Session exactly — option a) --------
-- No school_id column, same as staff `sessions`. Tenancy resolved by joining
-- through guardian_id — see the RLS policy and auth_resolve_guardian_session
-- below for the identical chicken-and-egg reasoning staff sessions already
-- solve. A parallel table, not a reuse of `sessions`: Session.userId is a
-- non-nullable FK to User, and widening it to cover guardians would drag the
-- staff RBAC/permissions machinery into a user class that never needs it.
CREATE TABLE "guardian_sessions" (
    "id"         TEXT NOT NULL,
    "guardian_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guardian_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "guardian_sessions_token_hash_key" ON "guardian_sessions"("token_hash");
CREATE INDEX "guardian_sessions_guardian_id_idx" ON "guardian_sessions"("guardian_id");

ALTER TABLE "guardian_sessions"
  ADD CONSTRAINT "guardian_sessions_guardian_id_fkey"
  FOREIGN KEY ("guardian_id") REFERENCES "guardians"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---- 1d. guardian_invitations (new table — option b) --------------------
-- A parallel table to `invitations`, not a reuse: unlike a staff invite
-- (where the User doesn't exist yet), the Guardian row already exists before
-- this flow starts — created earlier when the student was linked — so this
-- table carries only invitation-specific fields (token, expiry, acceptance),
-- not redundant name/email/phone copies already on the linked Guardian row.
-- school_id is denormalised for direct RLS (same pattern as
-- student_guardians); cleanup cascades through guardian_id rather than a
-- direct FK to School — Guardian itself has no FK to School either,
-- consistent with existing convention, not a new gap introduced here.
CREATE TABLE "guardian_invitations" (
    "id"          TEXT NOT NULL,
    "school_id"   TEXT NOT NULL,
    "guardian_id" TEXT NOT NULL,
    "token_hash"  TEXT NOT NULL,
    "invited_by"  TEXT NOT NULL,
    "expires_at"  TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guardian_invitations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "guardian_invitations_token_hash_key" ON "guardian_invitations"("token_hash");
CREATE INDEX "guardian_invitations_school_id_idx" ON "guardian_invitations"("school_id");
CREATE INDEX "guardian_invitations_guardian_id_idx" ON "guardian_invitations"("guardian_id");

ALTER TABLE "guardian_invitations"
  ADD CONSTRAINT "guardian_invitations_guardian_id_fkey"
  FOREIGN KEY ("guardian_id") REFERENCES "guardians"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- app_user grants: ALTER DEFAULT PRIVILEGES (slice 1 Neon setup) auto-grants
-- SELECT/INSERT/UPDATE/DELETE on every future table created by school_kit to
-- app_user — no manual GRANT needed here.

-- =========================================================================
-- 2. RLS policies
-- =========================================================================

ALTER TABLE "guardian_sessions"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "guardian_sessions"    FORCE  ROW LEVEL SECURITY;
ALTER TABLE "guardian_invitations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "guardian_invitations" FORCE  ROW LEVEL SECURITY;

-- guardian_sessions has no school_id column (option a) — joined-through-
-- guardians policy, identical shape to `sessions`' joined-through-users
-- policy in policies/phase-0.sql.
CREATE POLICY tenant_isolation ON guardian_sessions
  USING (EXISTS (
    SELECT 1 FROM guardians
    WHERE guardians.id = guardian_sessions.guardian_id
      AND guardians.school_id::text = current_setting('app.current_school_id', true)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM guardians
    WHERE guardians.id = guardian_sessions.guardian_id
      AND guardians.school_id::text = current_setting('app.current_school_id', true)
  ));

-- guardian_invitations has a direct school_id column (option b) — flat
-- policy, same shape as `guardians`/`student_guardians` in policies/phase-1.sql.
CREATE POLICY tenant_isolation ON guardian_invitations
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

-- =========================================================================
-- 3. auth_resolve_guardian_session(token_hash)
-- =========================================================================
--
-- Looks up a guardian session by token hash for the portal's AuthGuard
-- equivalent. Identical chicken-and-egg problem as auth_resolve_session:
-- guardian_sessions is under FORCE ROW LEVEL SECURITY, and the request
-- carries only a bearer token — no school_id to plug into the GUC until
-- after this lookup runs.
--
-- SECURITY DEFINER discipline (see CLAUDE.md "SECURITY DEFINER functions —
-- index" for the full inventory):
--   1. Owned by the migration role (school_kit).
--   2. SET search_path = public, pg_temp.
--   3. Returns scalars only — no full row.
--   4. EXECUTE revoked from PUBLIC, granted to app_user only.
--
-- Returns (when row exists):
--   session_id  — text id of the session row (logout target)
--   guardian_id — text id of the guardian that owns the session
--   school_id   — resolved via the join to guardians; the request sets this
--                 GUC before any subsequent tenant-scoped query
--   expires_at  — timestamp(3); guard compares against NOW()
--
-- Returns NO ROWS when:
--   - no session matches the token hash
--   - (expired rows still match — caller decides, same as staff)
--
-- DELIBERATELY NOT RETURNED:
--   - password_hash — guard has no reason to see it.
--   - email / phone / names — guard runs pre-tenant; PII does not belong in
--     a request-attached context that may be logged.
--   - Guardian currently has no is_active-equivalent column (unlike User) —
--     there is no way to deactivate portal access short of clearing
--     password_hash. Flagged as a follow-up gap, not addressed in this
--     slice (out of Decision A's locked field list).

CREATE OR REPLACE FUNCTION auth_resolve_guardian_session(p_token_hash text)
RETURNS TABLE(
  session_id  text,
  guardian_id text,
  school_id   text,
  expires_at  timestamp(3)
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    gs.id          AS session_id,
    gs.guardian_id AS guardian_id,
    g.school_id    AS school_id,
    gs.expires_at  AS expires_at
  FROM guardian_sessions gs
  JOIN guardians g ON g.id = gs.guardian_id
  WHERE gs.token_hash = p_token_hash
$$;

REVOKE ALL ON FUNCTION auth_resolve_guardian_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_resolve_guardian_session(text) TO app_user;

-- =========================================================================
-- 4. auth_lookup_guardians_for_login(email) — INTERIM, multi-row
-- =========================================================================
--
-- Looks up EVERY guardian row matching an email, across ALL schools, so the
-- portal login service can attempt argon2.verify against each candidate in
-- turn (option ii, approved 2026-07-16 as an interim strategy — see
-- docs/modules/phase-4.md slice 2 plan-first "login disambiguation" and
-- CLAUDE.md's guardian-auth note).
--
-- WHY THIS FUNCTION IS SHAPED DIFFERENTLY FROM auth_lookup_user_for_login:
-- Staff's User.email is globally @unique (schema.prisma:83), so a single
-- WHERE email = ... always resolves at most one row. Guardian.email is
-- UNIQUE ONLY PER SCHOOL (Decision C) — deliberately, so a guardian with
-- children at two schools gets two separate portal accounts. That means the
-- SAME email can legitimately return multiple rows across different
-- schools, and the login form (slice 1's static shell) collects only email +
-- password, with no school selector. This function returns every match; the
-- login service tries argon2.verify against each row's password_hash in
-- turn and logs in against whichever school matches. If more than one
-- matches (a guardian who reused the same password at two schools), that's
-- a genuine ambiguity the service layer must handle explicitly (e.g. a
-- follow-up "which school?" step) — not resolved by this function.
--
-- THIS IS DOCUMENTED AS INTERIM: a real fix (e.g. a school selector /
-- subdomain in the portal login flow) is deferred, not designed here. If
-- that lands in a later slice, this function's multi-row shape and the
-- service-layer verify-loop it enables should be revisited together.
--
-- SECURITY DEFINER discipline: same four points as every function in this
-- index (see CLAUDE.md).
--
-- Returns (zero or more rows):
--   guardian_id   — text id (used to mint the session on successful verify)
--   school_id     — text id of the tenant this candidate belongs to
--   password_hash — argon2id hash; caller MUST argon2.verify it and MUST
--                   NOT log, return in a response, or persist it
--
-- Returns NO ROWS when:
--   - no guardian has that email
--   - every guardian with that email has password_hash IS NULL (never
--     accepted a portal invitation) — login is impossible by definition;
--     treated as no-such-guardian, same INVALID_CREDENTIALS response shape
--     as staff login uses for an unknown email.
--
-- DELIBERATELY NOT RETURNED:
--   - phone, names — login does not need them.
--   - email_verified — always true whenever password_hash is set (both are
--     written together on invitation accept), so redundant for this check.

CREATE OR REPLACE FUNCTION auth_lookup_guardians_for_login(p_email text)
RETURNS TABLE(
  guardian_id   text,
  school_id     text,
  password_hash text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    g.id            AS guardian_id,
    g.school_id     AS school_id,
    g.password_hash AS password_hash
  FROM guardians g
  WHERE g.email = p_email
    AND g.password_hash IS NOT NULL
$$;

REVOKE ALL ON FUNCTION auth_lookup_guardians_for_login(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_lookup_guardians_for_login(text) TO app_user;

-- =========================================================================
-- 5. auth_resolve_guardian_invitation_by_token_hash(token_hash)
-- =========================================================================
--
-- Looks up a guardian portal invitation by token hash so the public accept-
-- page endpoints can validate the token and discover the school_id before
-- withTenant() can apply. Identical chicken-and-egg problem as
-- auth_resolve_invitation_by_token_hash; guardian_invitations is under
-- FORCE ROW LEVEL SECURITY and the caller has no session yet.
--
-- Unlike the staff invitation function, contact fields (first_name,
-- last_name, email) are NOT stored on guardian_invitations itself (option b
-- — see the table's own header comment) — they're read via the join to
-- guardians here instead.
--
-- SECURITY DEFINER discipline: same four points as every function in this
-- index (see CLAUDE.md).
--
-- Returns (when row exists):
--   invitation_id — text id (used to atomically claim on accept via
--                   UPDATE ... WHERE accepted_at IS NULL)
--   school_id     — text id of the tenant; caller sets this GUC before
--                   every subsequent tenant-scoped query
--   guardian_id   — text id of the guardian this invitation is for; caller
--                   sets password_hash/email_verified/portal_invited_at on
--                   THIS existing row on accept (not a new row — the
--                   guardian already exists, unlike staff invitation accept)
--   first_name    — pre-fill for the accept form, from the joined guardian
--   last_name     — pre-fill for the accept form, from the joined guardian
--   email         — invitee email, from the joined guardian (accept form
--                   shows it back to the user; never editable)
--   invited_by    — text id of the inviting admin user; caller scopes to
--                   the invitation's tenant and looks up the inviter's
--                   display name
--   expires_at    — timestamp(3); caller compares against NOW()
--   accepted_at   — timestamp(3), nullable; caller short-circuits when set
--
-- Returns NO ROWS when:
--   - no invitation matches the token hash (caller maps to 404)
--
-- DELIBERATELY NOT RETURNED:
--   - token_hash — caller already has the raw token they hashed in.
--   - phone — not needed by the accept form; read tenant-scoped elsewhere
--     if ever needed.
--   - created_at — not needed by either accept endpoint.

CREATE OR REPLACE FUNCTION auth_resolve_guardian_invitation_by_token_hash(p_token_hash text)
RETURNS TABLE(
  invitation_id text,
  school_id     text,
  guardian_id   text,
  first_name    text,
  last_name     text,
  email         text,
  invited_by    text,
  expires_at    timestamp(3),
  accepted_at   timestamp(3)
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    gi.id          AS invitation_id,
    gi.school_id   AS school_id,
    gi.guardian_id AS guardian_id,
    g.first_name   AS first_name,
    g.last_name    AS last_name,
    g.email        AS email,
    gi.invited_by  AS invited_by,
    gi.expires_at  AS expires_at,
    gi.accepted_at AS accepted_at
  FROM guardian_invitations gi
  JOIN guardians g ON g.id = gi.guardian_id
  WHERE gi.token_hash = p_token_hash
$$;

REVOKE ALL ON FUNCTION auth_resolve_guardian_invitation_by_token_hash(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_resolve_guardian_invitation_by_token_hash(text) TO app_user;

-- =========================================================================
-- 6. RBAC: add guardian.invite to the system admin role
-- =========================================================================
--
-- Same idempotent pattern as every prior RBAC-rollup migration (e.g.
-- 20260709000000_phase_3_slice_13_expenses): NOT ... @> guard prevents
-- duplicate JSON entries on a re-run. No owner-only restriction — this
-- isn't a highest-trust surface (unlike payment.refund/staff-bvn.reveal).
-- Owner has the '*' wildcard already. Bursar is not granted this — the role
-- is an inclusion list (PHASE_3_BURSAR_PERMISSIONS) that Phase 4 doesn't
-- touch, so bursar simply never gains it without an explicit future add.
-- packages/db/src/seeds/system-roles.ts's ADMIN_PERMISSIONS is updated in
-- the same PR so a FRESH `pnpm db:seed` matches this UPDATE exactly.

UPDATE "roles"
SET "permissions" = "permissions" || '["guardian.invite"]'::jsonb
WHERE "key" = 'admin'
  AND "is_system" = true
  AND NOT ("permissions" @> '["guardian.invite"]'::jsonb);
