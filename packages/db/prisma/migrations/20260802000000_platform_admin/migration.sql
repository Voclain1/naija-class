-- Platform super-admin — internal, read-only, cross-tenant admin surface.
-- Plan-first approved 2026-08-02. Scope is deliberately minimal: schools +
-- users visibility only (names, signup dates, status, basic counts). No
-- cross-tenant writes, no acting-as-a-school, no financial detail, no
-- student PII beyond basic metadata.
--
-- =========================================================================
-- 1. Schema change — User.isPlatformAdmin
-- =========================================================================
--
-- Granted ONLY via a direct DB UPDATE (no self-serve UI, no invite flow):
--   UPDATE users SET is_platform_admin = true WHERE id = '<user-id>';
--
-- Reuses existing Better Auth login/password/session mechanics — this is
-- NOT a new credential system. A platform admin is simply a User row (in
-- some school, like any other staff account) with this flag set; the flag
-- is re-read from the DB on every platform-admin request
-- (platform_admin_resolve_session below), never trusted from a token or
-- session payload — same discipline as the existing `is_active` check in
-- auth_resolve_session.

ALTER TABLE "users" ADD COLUMN "is_platform_admin" BOOLEAN NOT NULL DEFAULT false;

-- =========================================================================
-- 2. platform_admin_resolve_session(token_hash)
-- =========================================================================
--
-- PlatformAdminGuard's session lookup. Deliberately reuses the SAME
-- `sessions` table every staff session lives in (no parallel session store,
-- per "no new credential system" above) — this means ANY valid staff bearer
-- token (owner/admin/teacher/bursar, minted by ordinary login) resolves to
-- a real row here. The security boundary is NOT "does a session exist" —
-- it's the `is_platform_admin` column, which the guard must check and
-- reject on (403, not 401) for every non-platform-admin session. This is
-- intentional: it's what lets a test assert "an ordinary owner/admin/
-- teacher/bursar bearer token gets a real 403 from PlatformAdminGuard"
-- without needing a second token-minting path.
--
-- SECURITY DEFINER discipline (see CLAUDE.md "SECURITY DEFINER functions —
-- index" for the full inventory):
--   1. Owned by the migration role (school_kit).
--   2. SET search_path = public, pg_temp.
--   3. Returns scalars only — no full row.
--   4. EXECUTE revoked from PUBLIC, granted to app_user only.
--
-- Returns (when row exists):
--   session_id         — text id of the session row.
--   user_id             — text id of the session's owner.
--   is_platform_admin   — live from users.is_platform_admin; the ONLY
--                          authorization signal this guard trusts.
--   expires_at          — timestamp(3); guard compares against NOW(), same
--                          read-only hot-path convention as auth_resolve_session
--                          (no DELETE here).
--
-- Deliberately NOT returned (unlike auth_resolve_session):
--   - school_id — platform-admin identity is cross-tenant by definition;
--     there is no single tenant to scope this session to.
--   - user_is_active — out of scope for this minimal pass (no platform-
--     admin deactivation flow exists yet; revocation today is bounded by
--     session TTL only, same as any other session). Flagged here, not
--     silently assumed, so a future slice that adds platform-admin
--     deactivation knows to extend this function's return shape too.
--   - password_hash, email, phone, names — guard runs pre-tenant; PII does
--     not belong in a request-attached context that may be logged.

CREATE OR REPLACE FUNCTION platform_admin_resolve_session(p_token_hash text)
RETURNS TABLE(
  session_id         text,
  user_id             text,
  is_platform_admin   boolean,
  expires_at          timestamp(3)
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    s.id                AS session_id,
    s.user_id           AS user_id,
    u.is_platform_admin AS is_platform_admin,
    s.expires_at        AS expires_at
  FROM sessions s
  JOIN users u ON u.id = s.user_id
  WHERE s.token_hash = p_token_hash
$$;

REVOKE ALL ON FUNCTION platform_admin_resolve_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_admin_resolve_session(text) TO app_user;

-- =========================================================================
-- 3. platform_admin_list_schools()
-- =========================================================================
--
-- Cross-tenant school roster for the platform-admin dashboard. Called only
-- from PlatformAdminController routes already gated by PlatformAdminGuard
-- (this function itself has no caller-identity check — same pattern as
-- create_audit_log_partition, which is likewise only ever invoked from
-- trusted, already-authorized app code, not exposed on any public path).
--
-- SECURITY DEFINER discipline: same four points as every function in this
-- index (see CLAUDE.md).
--
-- Returns (zero or more rows, one per school):
--   school_id      — text id.
--   name           — school display name.
--   created_at     — timestamp(3) signup date.
--   is_active      — derived from School.status = 'ACTIVE' (schools also
--                    have ONBOARDING/SUSPENDED/ARCHIVED — collapsed to a
--                    single boolean here per the approved minimal scope;
--                    the full status enum is NOT exposed).
--   student_count  — count of `students` rows for this school.
--   staff_count    — count of `users` rows for this school (there is no
--                    separate Staff model — every non-student, non-guardian
--                    person is a User row).
--
-- Deliberately NOT returned:
--   - slug, address, phone, email, primaryColor, logoUrl, onboardingStep,
--     ndprConsent, Paystack fields — none of this is "basic metadata";
--     financial/config detail is explicitly out of this surface's scope.

CREATE OR REPLACE FUNCTION platform_admin_list_schools()
RETURNS TABLE(
  school_id      text,
  name           text,
  created_at     timestamp(3),
  is_active      boolean,
  student_count  bigint,
  staff_count    bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    s.id                        AS school_id,
    s.name                      AS name,
    s.created_at                AS created_at,
    (s.status = 'ACTIVE')       AS is_active,
    (SELECT count(*) FROM students st WHERE st.school_id = s.id) AS student_count,
    (SELECT count(*) FROM users   u  WHERE u.school_id  = s.id) AS staff_count
  FROM schools s
  ORDER BY s.created_at DESC
$$;

REVOKE ALL ON FUNCTION platform_admin_list_schools() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_admin_list_schools() TO app_user;

-- =========================================================================
-- 4. platform_admin_list_users(school_id?)
-- =========================================================================
--
-- Cross-tenant (or single-school, when p_school_id is given) staff-account
-- roster. Staff basics only — no phone/BVN/student PII/financial fields.
--
-- SECURITY DEFINER discipline: same four points as every function in this
-- index (see CLAUDE.md).
--
-- Returns (zero or more rows, one per staff User row):
--   user_id         — text id.
--   school_id       — text id of the owning school (so the cross-tenant
--                      caller — p_school_id IS NULL — can tell rows apart).
--   first_name      — basic metadata, in scope per the approved plan.
--   last_name        — basic metadata, in scope per the approved plan.
--   role_names       — text[] of this user's role keys (owner/admin/
--                       teacher/bursar/...); empty array if none.
--   created_at        — timestamp(3) account-creation date.
--   last_login_at     — timestamp(3), nullable.
--   is_active         — same column AuthGuard checks; surfaced here as
--                        basic status, not a new authorization signal.
--
-- Deliberately NOT returned:
--   - email, phone — contact PII, out of scope.
--   - password_hash, totp*, bvn* — never leave the auth/BVN subsystems.
--   - is_platform_admin — this function is a read surface for platform
--     admins to see OTHER staff accounts; whether some other user is
--     itself a platform admin is not "basic metadata" and is deliberately
--     withheld (avoids this read surface doubling as a way to enumerate
--     who else holds platform-admin access).

CREATE OR REPLACE FUNCTION platform_admin_list_users(p_school_id text DEFAULT NULL)
RETURNS TABLE(
  user_id         text,
  school_id       text,
  first_name      text,
  last_name       text,
  role_names      text[],
  created_at      timestamp(3),
  last_login_at   timestamp(3),
  is_active       boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    u.id                                                              AS user_id,
    u.school_id                                                       AS school_id,
    u.first_name                                                      AS first_name,
    u.last_name                                                       AS last_name,
    COALESCE(array_agg(r.key) FILTER (WHERE r.key IS NOT NULL), ARRAY[]::text[]) AS role_names,
    u.created_at                                                      AS created_at,
    u.last_login_at                                                   AS last_login_at,
    u.is_active                                                       AS is_active
  FROM users u
  LEFT JOIN user_roles ur ON ur.user_id = u.id
  LEFT JOIN roles r ON r.id = ur.role_id
  WHERE p_school_id IS NULL OR u.school_id = p_school_id
  GROUP BY u.id
  ORDER BY u.created_at DESC
$$;

REVOKE ALL ON FUNCTION platform_admin_list_users(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_admin_list_users(text) TO app_user;
