-- Guardian portal deactivation, and platform-admin revocation by is_active
-- (2026-10-02).
--
-- Closes the gap the 2026-08-16 SECURITY DEFINER cadence review named as its
-- real finding (CLAUDE.md, "the four session resolvers DISAGREE ABOUT
-- REVOCATION"): two of the four could not revoke at all.
--
--   auth_resolve_student_session   student_status + portal_enabled   (unchanged)
--   auth_resolve_session           user_is_active                    (unchanged)
--   auth_resolve_guardian_session  NOTHING  -> portal_enabled         (this migration)
--   platform_admin_resolve_session NOTHING  -> user_is_active         (this migration)
--
-- A parent whose access a school needed to cut off kept a working session
-- for up to 30 days, and a platform admin whose staff account was switched
-- off (users.is_active = false) kept cross-tenant access.
--
-- SD COUNT UNCHANGED (23). Two functions change return shape (DROP + CREATE,
-- grants restated, because DROP resets them and a bare CREATE OR REPLACE
-- cannot change RETURNS TABLE). Two change only their WHERE (CREATE OR
-- REPLACE, which keeps owner and grants). No function is added or removed.

-- =========================================================================
-- 1. guardians.portal_disabled_at
-- =========================================================================
--
-- A TIMESTAMP, not an is_active boolean, on purpose:
--
--   - It is scoped to PORTAL ACCESS, not to the guardian. A guardian is first
--     a contact the school keeps — the person absence SMS goes to — and only
--     second an account. "is_active" on this table would read as "this
--     contact is current", and someone would one day filter SMS on it.
--   - When access was cut is the question a school is asked next. The audit
--     log says who; this column answers when without a join.
--
-- NULL = enabled, which is what every existing row correctly is. No backfill.
-- password_hash is deliberately left alone on deactivation, so reactivating
-- restores access without a fresh invitation.
ALTER TABLE "guardians" ADD COLUMN "portal_disabled_at" TIMESTAMP(3);

-- =========================================================================
-- 2. auth_resolve_guardian_session — now returns portal_enabled
-- =========================================================================
--
-- SECURITY DEFINER discipline unchanged (CLAUDE.md inventory): owned by
-- school_kit, search_path pinned, scalars only, EXECUTE to app_user only.
--
-- Returns: session_id, guardian_id, school_id, expires_at, portal_enabled.
--
-- portal_enabled is RETURNED rather than filtered in the WHERE, matching
-- auth_resolve_session's user_is_active: a filtered row would surface as
-- INVALID_SESSION, and the guard could not tell the parent the truth — that
-- the SCHOOL switched their access off, which is something they can act on
-- (ring the school) where "you were signed out" is not. Same name as
-- auth_resolve_student_session's portal_enabled, because it is the same idea
-- for a different principal.
--
-- Deliberately NOT returned: password_hash, email, phone, names — unchanged
-- from the original, and portal_disabled_at itself (the guard needs the
-- boolean; the date is admin-facing and read under RLS).
DROP FUNCTION auth_resolve_guardian_session(text);

CREATE FUNCTION auth_resolve_guardian_session(p_token_hash text)
RETURNS TABLE(
  session_id     text,
  guardian_id    text,
  school_id      text,
  expires_at     timestamp(3),
  portal_enabled boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    gs.id                         AS session_id,
    gs.guardian_id                AS guardian_id,
    g.school_id                   AS school_id,
    gs.expires_at                 AS expires_at,
    (g.portal_disabled_at IS NULL) AS portal_enabled
  FROM guardian_sessions gs
  JOIN guardians g ON g.id = gs.guardian_id
  WHERE gs.token_hash = p_token_hash
$$;

REVOKE ALL ON FUNCTION auth_resolve_guardian_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_resolve_guardian_session(text) TO app_user;

-- =========================================================================
-- 3. auth_lookup_guardians_for_login — excludes disabled accounts
-- =========================================================================
--
-- Return shape unchanged, so CREATE OR REPLACE (owner and grants carry over).
--
-- Filtered IN SQL, not checked in the service, for two reasons:
--   - This function is multi-row (Guardian.email is unique per school only,
--     Decision C). A disabled account left in the candidate list would still
--     take part in the password-matching loop, and could turn one parent's
--     sign-in at their other school into AMBIGUOUS_GUARDIAN_ACCOUNT.
--   - Absent from the list, a disabled account fails exactly like a wrong
--     password (INVALID_CREDENTIALS) — the staff rule in AuthService.login:
--     "We do NOT want a deactivated user to know whether the password they
--     typed was correct."
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
    AND g.portal_disabled_at IS NULL
$$;

-- =========================================================================
-- 4. auth_lookup_guardians_for_password_reset — excludes disabled accounts
-- =========================================================================
--
-- Return shape unchanged, so CREATE OR REPLACE. This function already
-- filters password_hash IS NOT NULL in SQL so that recovery cannot become an
-- ACTIVATION backdoor around the invitation flow; a disabled account is the
-- same hazard in a different place — recovery must not become a
-- REACTIVATION backdoor around the school's decision. A disabled parent who
-- asks for a reset gets the same "if an account exists…" response as anyone
-- else, and no email.
CREATE OR REPLACE FUNCTION auth_lookup_guardians_for_password_reset(p_email text)
RETURNS TABLE (guardian_id text, school_id text, school_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT g.id, g.school_id, s.name
  FROM guardians g
  JOIN schools s ON s.id = g.school_id
  WHERE g.email = p_email
    AND g.password_hash IS NOT NULL
    AND g.portal_disabled_at IS NULL;
$$;

-- =========================================================================
-- 5. platform_admin_resolve_session — now returns user_is_active
-- =========================================================================
--
-- The original header flagged this exact extension: "a future slice that
-- adds platform-admin deactivation knows to extend this function's return
-- shape too". No new flow is needed for the lever itself — users.is_active
-- already exists and AuthGuard already honours it. What was missing is this
-- guard reading it, so a staff account switched off kept platform access.
--
-- Returns: session_id, user_id, is_platform_admin, expires_at, user_is_active.
-- Deliberately NOT returned: school_id, password_hash, email, phone, names —
-- unchanged from the original.
DROP FUNCTION platform_admin_resolve_session(text);

CREATE FUNCTION platform_admin_resolve_session(p_token_hash text)
RETURNS TABLE(
  session_id        text,
  user_id           text,
  is_platform_admin boolean,
  expires_at        timestamp(3),
  user_is_active    boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    s.id                AS session_id,
    s.user_id           AS user_id,
    u.is_platform_admin AS is_platform_admin,
    s.expires_at        AS expires_at,
    u.is_active         AS user_is_active
  FROM sessions s
  JOIN users u ON u.id = s.user_id
  WHERE s.token_hash = p_token_hash
$$;

REVOKE ALL ON FUNCTION platform_admin_resolve_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_admin_resolve_session(text) TO app_user;
