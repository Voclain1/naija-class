-- Plans and student caps (2026-10-11, docs/modules/plans.md).
--
-- 1. "SchoolPlan" enum and schools.plan (default FREE) plus
--    schools.student_cap_override (nullable). Set by the platform operator;
--    nothing bills. Every existing school starts on FREE with no override.
--
-- 2. platform_admin_list_schools() — 9th revision (DROP + CREATE, grants
--    restated), adds plan, student_cap_override and students_on_roll, so
--    PATCH .../plan is read back and the operator can see each school against
--    its cap before switching enforcement on. students_on_roll is an
--    aggregate count, like student_count (statuses ACTIVE, INACTIVE,
--    SUSPENDED: plans.md D2). The plan is operator-set status about the
--    tenancy, not the school's own financial configuration; no price or
--    billing field exists to return.
--
-- SECURITY DEFINER count unchanged at 23.

CREATE TYPE "SchoolPlan" AS ENUM ('FREE', 'STARTER', 'GROWTH', 'PROFESSIONAL', 'ENTERPRISE');

ALTER TABLE "schools" ADD COLUMN "plan" "SchoolPlan" NOT NULL DEFAULT 'FREE';
ALTER TABLE "schools" ADD COLUMN "student_cap_override" INTEGER;
ALTER TABLE "schools" ADD CONSTRAINT "schools_student_cap_override_positive"
  CHECK ("student_cap_override" IS NULL OR "student_cap_override" > 0);

-- -------------------------------------------------------------------------
-- 2. platform_admin_list_schools() — 9th revision
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
  smart_import_enabled     boolean,
  plan                     text,
  student_cap_override     integer,
  students_on_roll         bigint
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
    s.smart_import_enabled       AS smart_import_enabled,
    s.plan::text                 AS plan,
    s.student_cap_override       AS student_cap_override,
    (SELECT count(*) FROM students st
      WHERE st.school_id = s.id
        AND st.status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED')) AS students_on_roll
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
