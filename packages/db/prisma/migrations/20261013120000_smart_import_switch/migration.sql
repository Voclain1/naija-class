-- Smart Student Import gets its own per-school switch (2026-10-11).
--
-- 1. schools.smart_import_enabled, default false. Until now the feature had no
--    gate of its own (smart-student-import.md D2): any school with ai_enabled
--    could photograph a register and send children's names to the model,
--    although the module doc says no school should use it before the
--    real-register accuracy check. Every existing school starts with it off;
--    the platform operator turns it on per school
--    (PATCH /platform-admin/schools/:id/smart-import).
--
-- 2. platform_admin_list_schools() — 8th revision, adds smart_import_enabled
--    (DROP + CREATE, grants restated), so the operator can read back what the
--    switch is set to: the blind-write rule. The column is operator-set status
--    about the tenancy, like ai_enabled beside it.
--
-- SECURITY DEFINER count unchanged at 23.

ALTER TABLE "schools" ADD COLUMN "smart_import_enabled" BOOLEAN NOT NULL DEFAULT false;

-- -------------------------------------------------------------------------
-- 2. platform_admin_list_schools() — 8th revision
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
  suspended_at             timestamp(3),
  smart_import_enabled     boolean
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
    s.suspended_at               AS suspended_at,
    s.smart_import_enabled       AS smart_import_enabled
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
