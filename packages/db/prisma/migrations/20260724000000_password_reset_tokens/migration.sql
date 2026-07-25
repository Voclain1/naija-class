-- Phase 0 gap closed 2026-07-24 — forgot/reset password flow.
--
-- docs/modules/phase-0.md specced `POST /auth/forgot-password`,
-- `POST /auth/reset-password`, `/forgot-password`, `/reset-password/[token]`
-- back at Phase 0 planning, but no code was ever written — confirmed by a
-- codebase-wide grep turning up zero routes, controllers, or DTOs before
-- this migration. Built now, mirroring the invitation token pattern
-- (raw token → sha256 hash stored, resolved pre-tenant via a SECURITY
-- DEFINER function) that 20260517000000_invitation_names_and_lookup and
-- 20260716000000_phase_4_slice_2_guardian_auth already established — see
-- those files for the fuller chicken-and-egg rationale; this header only
-- covers what's specific to password reset.
--
-- Two new SECURITY DEFINER functions (SD count moves 10 -> 12; already past
-- the "+3 cadence" review trigger set at the Phase 3/Slice 12 audit and due
-- since Phase 4/Slice 2 — still not done, not addressed by this migration
-- either; flagged again, not resolved). CLAUDE.md's inventory table and
-- apps/api/src/__tests__/security-definer-inventory.spec.ts are updated in
-- the same PR as this migration.

-- =========================================================================
-- 1. Schema change
-- =========================================================================

-- Unlike guardian_invitations (a new Guardian gets invited before it has a
-- User-equivalent row), a password reset always targets an EXISTING user —
-- hence the user_id FK this table has and Invitation doesn't. school_id is
-- denormalised onto the row for a flat RLS policy (same pattern as
-- invitations/guardian_invitations), even though it's also derivable via
-- the user_id join — direct column keeps the policy a single comparison,
-- consistent with every other tenant-scoped table in this schema.
CREATE TABLE "password_reset_tokens" (
    "id"         TEXT NOT NULL,
    "school_id"  TEXT NOT NULL,
    "user_id"    TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at"    TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");
CREATE INDEX "password_reset_tokens_school_id_idx" ON "password_reset_tokens"("school_id");
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

ALTER TABLE "password_reset_tokens"
  ADD CONSTRAINT "password_reset_tokens_school_id_fkey"
  FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "password_reset_tokens"
  ADD CONSTRAINT "password_reset_tokens_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- app_user grants: ALTER DEFAULT PRIVILEGES (slice 1 Neon setup) auto-grants
-- SELECT/INSERT/UPDATE/DELETE on every future table created by school_kit to
-- app_user — no manual GRANT needed here.

-- =========================================================================
-- 2. RLS policy
-- =========================================================================

ALTER TABLE "password_reset_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "password_reset_tokens" FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON password_reset_tokens
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

-- =========================================================================
-- 3. auth_lookup_user_for_password_reset(email)
-- =========================================================================
--
-- Looks up a user by email so POST /auth/forgot-password can find who to
-- issue a reset token for. Same chicken-and-egg problem as
-- auth_lookup_user_for_login: `users` is under FORCE ROW LEVEL SECURITY and
-- the caller has no session yet.
--
-- Deliberately NOT auth_lookup_user_for_login reused: that function returns
-- password_hash, which forgot-password has no reason to ever hold in
-- memory — reusing it would pull a secret into a code path that doesn't
-- need it, widening the accidental-logging surface for no benefit. Per the
-- Slice-12 inventory audit (CLAUDE.md), each auth flow gets its own
-- function narrowed to that caller's exact need rather than a shared one
-- with a wider return shape.
--
-- SECURITY DEFINER discipline (see CLAUDE.md "SECURITY DEFINER functions —
-- index" for the full inventory):
--   1. Owned by the migration role (school_kit).
--   2. SET search_path = public, pg_temp.
--   3. Returns scalars only — no full row.
--   4. EXECUTE revoked from PUBLIC, granted to app_user only.
--
-- Returns (when row exists — users.email is globally @unique, so at most
-- one row, unlike guardians' per-school-unique email):
--   user_id   — text id of the user (used to mint the reset token)
--   school_id — text id of the tenant; caller sets this GUC before every
--               subsequent tenant-scoped query
--   is_active — boolean; caller skips token issuance for a deactivated
--               user (same "don't grant what login itself would refuse"
--               principle as the is_active check in AuthService.login)
--
-- Returns NO ROWS when:
--   - no user has that email — caller must NOT let this distinguish the
--     forgot-password response from the found case; both return the same
--     generic "if that email exists, we sent instructions" message
--     (account-enumeration guard, same spirit as login's dummy-hash trick)
--
-- DELIBERATELY NOT RETURNED:
--   - password_hash — see rationale above; this function's caller never
--     verifies a password.
--   - phone, names — forgot-password does not need them.

CREATE OR REPLACE FUNCTION auth_lookup_user_for_password_reset(p_email text)
RETURNS TABLE(
  user_id   text,
  school_id text,
  is_active boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    u.id        AS user_id,
    u.school_id AS school_id,
    u.is_active AS is_active
  FROM users u
  WHERE u.email = p_email
$$;

REVOKE ALL ON FUNCTION auth_lookup_user_for_password_reset(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_lookup_user_for_password_reset(text) TO app_user;

-- =========================================================================
-- 4. auth_resolve_password_reset_token(token_hash)
-- =========================================================================
--
-- Looks up a password reset token by hash so POST /auth/reset-password can
-- validate it and discover the school_id before withTenant() can apply.
-- Identical chicken-and-egg problem as auth_resolve_invitation_by_token_hash;
-- password_reset_tokens is under FORCE ROW LEVEL SECURITY and the caller
-- has no session yet.
--
-- SECURITY DEFINER discipline: same four points as every function in this
-- index (see CLAUDE.md).
--
-- Returns (when row exists):
--   reset_id   — text id of the token row (claimed atomically on reset via
--                UPDATE ... WHERE used_at IS NULL, same race-safe pattern
--                as invitation accept)
--   user_id    — text id of the user whose password_hash gets overwritten
--   school_id  — text id of the tenant; caller sets this GUC before every
--                subsequent tenant-scoped query
--   expires_at — timestamp(3); caller compares against NOW() to decide
--                410 PASSWORD_RESET_EXPIRED
--   used_at    — timestamp(3), nullable; caller short-circuits to 410
--                PASSWORD_RESET_ALREADY_USED when set
--
-- Returns NO ROWS when:
--   - no token matches the hash (caller maps to 404)
--
-- DELIBERATELY NOT RETURNED:
--   - token_hash — the caller already has the raw token they hashed in.
--   - email/names — the reset-password form has nothing to pre-fill (unlike
--     invitation accept); it only needs a new password field.

CREATE OR REPLACE FUNCTION auth_resolve_password_reset_token(p_token_hash text)
RETURNS TABLE(
  reset_id   text,
  user_id    text,
  school_id  text,
  expires_at timestamp(3),
  used_at    timestamp(3)
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    prt.id         AS reset_id,
    prt.user_id    AS user_id,
    prt.school_id  AS school_id,
    prt.expires_at AS expires_at,
    prt.used_at    AS used_at
  FROM password_reset_tokens prt
  WHERE prt.token_hash = p_token_hash
$$;

REVOKE ALL ON FUNCTION auth_resolve_password_reset_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_resolve_password_reset_token(text) TO app_user;
