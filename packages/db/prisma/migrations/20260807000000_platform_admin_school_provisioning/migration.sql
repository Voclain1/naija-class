-- Platform super-admin — first WRITE action on the surface. Plan-first
-- approved 2026-08-07. Adds school provisioning: a platform admin supplies
-- a school name + owner email; the API creates the School row and an
-- `owner`-role Invitation, reusing the existing Invitation/accept/session
-- machinery unchanged (see CLAUDE.md "Platform super-admin" note for the
-- fuller writeup). This migration only touches the two SECURITY DEFINER
-- functions the pre-tenant read side needs — the write itself (School +
-- Invitation creation) is ordinary Prisma via basePrisma.$transaction with
-- a raw `SET LOCAL app.current_school_id`, the same pattern
-- AuthService.signupOwner already uses, so it needs no new function.
--
-- =========================================================================
-- 1. platform_admin_check_owner_email_available(p_email)
-- =========================================================================
--
-- Pre-write availability check, same "cheap rejection stays cheap"
-- rationale as auth_check_signup_uniqueness (see
-- 20260515000000_add_signup_uniqueness_function). Both `users` and
-- `invitations` are under FORCE RLS, so a GUC-less basePrisma query against
-- either returns nothing, not the truth — this function is the only way to
-- answer "is this email available for a new owner invite" before a tenant
-- (and therefore a GUC) exists.
--
-- Checks two independent things and reports which (if either) blocked:
--   1. USER_EXISTS   — a User row already has this email, anywhere on the
--      platform (`users.email` is globally unique, unlike per-school
--      Guardian.email) — covers "already an owner elsewhere" and "already
--      staff/teacher/bursar somewhere."
--   2. INVITE_PENDING — an unaccepted, unexpired `owner`-role Invitation
--      already targets this email, at any school. Ordinary staff invites
--      can never collide here: UsersService.invite()'s roleKey allow-list
--      explicitly excludes 'owner', so every owner-role invitation was
--      created by this platform-admin flow.
--
-- A Guardian with the same email is deliberately NOT checked — guardians
-- are a separate table with a separate login flow (and per-school-unique
-- email, not global), so a collision there isn't a real conflict for a
-- staff/owner account.
--
-- SECURITY DEFINER discipline (see CLAUDE.md "SECURITY DEFINER functions —
-- index" for the full inventory):
--   1. Owned by the migration role (school_kit).
--   2. SET search_path = public, pg_temp.
--   3. Returns scalars only — no full row, no ids.
--   4. EXECUTE revoked from PUBLIC, granted to app_user only.
--
-- Race conditions: pre-check followed by INSERT is not atomic, same
-- accepted gap as auth_check_signup_uniqueness — the rare double-submit
-- race becomes a less-helpful error, not a corrupted row. No new DB-level
-- unique index is added for the pending-invite case either; this matches
-- UsersService.invite()'s own pending-invitation check, which is also
-- application/function-level only, not a DB constraint.

CREATE OR REPLACE FUNCTION platform_admin_check_owner_email_available(p_email text)
RETURNS TABLE(is_available boolean, reason text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    NOT (user_exists OR invite_pending) AS is_available,
    CASE
      WHEN user_exists THEN 'USER_EXISTS'
      WHEN invite_pending THEN 'INVITE_PENDING'
      ELSE NULL
    END AS reason
  FROM (
    SELECT
      EXISTS(SELECT 1 FROM users WHERE email = p_email) AS user_exists,
      EXISTS(
        SELECT 1 FROM invitations
        WHERE email = p_email
          AND role_key = 'owner'
          AND accepted_at IS NULL
          AND expires_at > now()
      ) AS invite_pending
  ) checks
$$;

REVOKE ALL ON FUNCTION platform_admin_check_owner_email_available(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_admin_check_owner_email_available(text) TO app_user;

-- =========================================================================
-- 2. platform_admin_list_schools() — return shape extended
-- =========================================================================
--
-- Adds owner_invite_pending / owner_invite_expires_at so the dashboard can
-- show a real "Pending" badge for a provisioned-but-not-yet-accepted
-- school, rather than inferring it from staff_count = 0. Deliberately NOT
-- a new SchoolStatus enum value — a platform-admin-provisioned school
-- genuinely IS status='ONBOARDING' (the same status a self-serve school
-- has mid-wizard), just with zero users yet; the distinguishing signal is
-- the presence of a live owner-role invitation, not a school-level status.
--
-- Changing a SECURITY DEFINER function's return columns needs DROP +
-- CREATE (not just CREATE OR REPLACE, which cannot change the return
-- type), so this section drops and recreates the whole function — same
-- grants as before, one query change (an added LEFT JOIN LATERAL for the
-- two new columns).
--
-- Returns (zero or more rows, one per school) — unchanged columns keep
-- their original meaning (see 20260802000000_platform_admin for the base
-- rationale); new columns:
--   owner_invite_pending    — true iff an unaccepted, unexpired `owner`-
--                              role Invitation exists for this school.
--                              Always false for self-serve schools (they
--                              never have an owner-role Invitation at all).
--   owner_invite_expires_at — timestamp(3) of that invitation's expiry,
--                              NULL when owner_invite_pending is false.

DROP FUNCTION platform_admin_list_schools();

CREATE FUNCTION platform_admin_list_schools()
RETURNS TABLE(
  school_id                text,
  name                     text,
  created_at               timestamp(3),
  is_active                boolean,
  student_count            bigint,
  staff_count              bigint,
  owner_invite_pending     boolean,
  owner_invite_expires_at  timestamp(3)
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    s.id                         AS school_id,
    s.name                       AS name,
    s.created_at                 AS created_at,
    (s.status = 'ACTIVE')        AS is_active,
    (SELECT count(*) FROM students st WHERE st.school_id = s.id) AS student_count,
    (SELECT count(*) FROM users   u  WHERE u.school_id  = s.id) AS staff_count,
    (oi.id IS NOT NULL)          AS owner_invite_pending,
    oi.expires_at                AS owner_invite_expires_at
  FROM schools s
  LEFT JOIN LATERAL (
    SELECT i.id, i.expires_at
    FROM invitations i
    WHERE i.school_id = s.id
      AND i.role_key = 'owner'
      AND i.accepted_at IS NULL
      AND i.expires_at > now()
    ORDER BY i.expires_at DESC
    LIMIT 1
  ) oi ON true
  ORDER BY s.created_at DESC
$$;

REVOKE ALL ON FUNCTION platform_admin_list_schools() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_admin_list_schools() TO app_user;
