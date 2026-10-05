-- =========================================================================
-- Platform-admin tools, slice 2 — school lifecycle (docs/modules/platform-admin.md)
-- =========================================================================
--
-- Owner's decisions (2026-10-05):
--   * Suspending a school blocks every sign-in — staff, parents, students —
--     and ends live sessions at their next request. Data is untouched, and
--     fees can still be paid through payment links (those are public pages,
--     not sessions, so nothing here touches them).
--   * A school may be deleted only if it has never recorded a payment, and
--     only after the operator types its slug.
--
-- This migration:
--   1. schools.suspended_at — WHEN the school was suspended, NULL when it is
--      not. A timestamp beside status rather than status = 'SUSPENDED':
--      status also carries ONBOARDING vs ACTIVE, and overwriting it would
--      lose where a suspended school was in onboarding. (Same choice as
--      guardians.portal_disabled_at, 2026-10-02.) SchoolStatus.SUSPENDED
--      stays unused.
--   2. schools.deletion_started_at — set inside the delete transaction, just
--      before the school's rows go, and gone with the row when it commits. It
--      never persists. It exists for one reader, (3).
--   3. exam_paper_frozen_guard() lets a school's own deletion through. As
--      shipped in CP5c it refused to delete a FINAL paper or its items under
--      ANY circumstances — which made a school holding one undeletable, by
--      the platform-admin path and by scripts/prune-smoke-schools.sql alike.
--      The guard now steps aside only when the school row says its deletion
--      has started: a property of the data, set by the paths that delete
--      schools, rather than a session setting any caller could set.
--   4. The three principal session resolvers return school_suspended — the
--      school-level revocation signal, beside each one's own (user_is_active,
--      portal_enabled, student_status). RETURNED rather than filtered in the
--      WHERE, like the others, so the guard can say "this school is
--      suspended" instead of an INVALID_SESSION that sends people to a
--      sign-in that cannot work. DROP + CREATE, grants restated.
--      platform_admin_resolve_session is deliberately NOT changed: platform
--      access is cross-tenant, and the API refuses to suspend a school that
--      holds a platform admin.
--   5. platform_admin_list_schools() returns suspended_at (DROP + CREATE), so
--      a suspension is visible on the roster — the blind-write rule again.
--
-- SECURITY DEFINER count unchanged at 23: four functions change shape, none
-- is added.

ALTER TABLE "schools" ADD COLUMN "suspended_at" TIMESTAMP(3);
ALTER TABLE "schools" ADD COLUMN "deletion_started_at" TIMESTAMP(3);

-- -------------------------------------------------------------------------
-- 3. Exam paper freeze steps aside for the school's own deletion
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION exam_paper_frozen_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_paper_id TEXT;
  v_status   "ExamPaperStatus";
BEGIN
  -- The whole school is being deleted (platform-admin delete, or the smoke
  -- prune): nothing is being edited, so there is nothing to freeze.
  IF TG_OP = 'DELETE' AND EXISTS (
    SELECT 1 FROM "schools"
    WHERE "id" = OLD."school_id" AND "deletion_started_at" IS NOT NULL
  ) THEN
    RETURN OLD;
  END IF;

  IF TG_TABLE_NAME = 'exam_papers' THEN
    IF OLD."status" = 'FINAL' THEN
      RAISE EXCEPTION 'exam paper % is FINAL and cannot be changed', OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_paper_id := COALESCE(NEW."paper_id", OLD."paper_id");
  SELECT "status" INTO v_status FROM "exam_papers" WHERE "id" = v_paper_id;
  -- A missing paper means its own cascade delete is running; nothing to guard.
  IF v_status = 'FINAL' THEN
    RAISE EXCEPTION 'exam paper % is FINAL and cannot be changed', v_paper_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- -------------------------------------------------------------------------
-- 4. Session resolvers return school_suspended
-- -------------------------------------------------------------------------
DROP FUNCTION auth_resolve_session(text);

CREATE FUNCTION auth_resolve_session(p_token_hash text)
RETURNS TABLE(
  session_id       text,
  user_id          text,
  school_id        text,
  expires_at       timestamp(3),
  user_is_active   boolean,
  school_suspended boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    s.id                          AS session_id,
    s.user_id                     AS user_id,
    u.school_id                   AS school_id,
    s.expires_at                  AS expires_at,
    u.is_active                   AS user_is_active,
    (sc.suspended_at IS NOT NULL) AS school_suspended
  FROM sessions s
  JOIN users u    ON u.id = s.user_id
  JOIN schools sc ON sc.id = u.school_id
  WHERE s.token_hash = p_token_hash
$$;

REVOKE ALL ON FUNCTION auth_resolve_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_resolve_session(text) TO app_user;

DROP FUNCTION auth_resolve_guardian_session(text);

CREATE FUNCTION auth_resolve_guardian_session(p_token_hash text)
RETURNS TABLE(
  session_id       text,
  guardian_id      text,
  school_id        text,
  expires_at       timestamp(3),
  portal_enabled   boolean,
  school_suspended boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    gs.id                          AS session_id,
    gs.guardian_id                 AS guardian_id,
    g.school_id                    AS school_id,
    gs.expires_at                  AS expires_at,
    (g.portal_disabled_at IS NULL) AS portal_enabled,
    (sc.suspended_at IS NOT NULL)  AS school_suspended
  FROM guardian_sessions gs
  JOIN guardians g ON g.id = gs.guardian_id
  JOIN schools sc  ON sc.id = g.school_id
  WHERE gs.token_hash = p_token_hash
$$;

REVOKE ALL ON FUNCTION auth_resolve_guardian_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_resolve_guardian_session(text) TO app_user;

DROP FUNCTION auth_resolve_student_session(text);

CREATE FUNCTION auth_resolve_student_session(p_token_hash text)
RETURNS TABLE(
  session_id       text,
  student_id       text,
  school_id        text,
  expires_at       timestamp(3),
  student_status   text,
  portal_enabled   boolean,
  school_suspended boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    ss.id                         AS session_id,
    ss.student_id                 AS student_id,
    s.school_id                   AS school_id,
    ss.expires_at                 AS expires_at,
    s.status::text                AS student_status,
    (s.password_hash IS NOT NULL) AS portal_enabled,
    (sc.suspended_at IS NOT NULL) AS school_suspended
  FROM student_sessions ss
  JOIN students s ON s.id = ss.student_id
  JOIN schools sc ON sc.id = s.school_id
  WHERE ss.token_hash = p_token_hash
$$;

REVOKE ALL ON FUNCTION auth_resolve_student_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_resolve_student_session(text) TO app_user;

-- -------------------------------------------------------------------------
-- 5. platform_admin_list_schools() — 7th revision, adds suspended_at
-- -------------------------------------------------------------------------
DROP FUNCTION platform_admin_list_schools();

CREATE FUNCTION platform_admin_list_schools()
RETURNS TABLE(
  school_id                text,
  name                     text,
  slug                     text,
  created_at               timestamp(3),
  is_active                boolean,
  student_count            bigint,
  staff_count              bigint,
  has_owner                boolean,
  owner_invite_pending     boolean,
  owner_invite_expires_at  timestamp(3),
  early_access_granted_at  timestamp(3),
  ai_enabled               boolean,
  ai_monthly_token_budget  integer,
  staff_mobile_enabled     boolean,
  suspended_at             timestamp(3)
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    s.id                         AS school_id,
    s.name                       AS name,
    s.slug                       AS slug,
    s.created_at                 AS created_at,
    (s.status = 'ACTIVE')        AS is_active,
    (SELECT count(*) FROM students st WHERE st.school_id = s.id) AS student_count,
    (SELECT count(*) FROM users   u  WHERE u.school_id  = s.id) AS staff_count,
    EXISTS (
      SELECT 1
      FROM users u
      JOIN user_roles ur ON ur.user_id = u.id
      JOIN roles r ON r.id = ur.role_id
      WHERE u.school_id = s.id AND r.key = 'owner'
    )                            AS has_owner,
    (oi.id IS NOT NULL)          AS owner_invite_pending,
    oi.expires_at                AS owner_invite_expires_at,
    s.early_access_granted_at    AS early_access_granted_at,
    s.ai_enabled                 AS ai_enabled,
    s.ai_monthly_token_budget    AS ai_monthly_token_budget,
    s.staff_mobile_enabled       AS staff_mobile_enabled,
    s.suspended_at               AS suspended_at
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
