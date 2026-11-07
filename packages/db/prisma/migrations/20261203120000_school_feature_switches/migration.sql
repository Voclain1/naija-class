-- Per-school feature switches (2026-11-06, docs/modules/feature-switches.md;
-- docs/reviews/agentic-implementation-plan.md, first delivery FD-1a/FD-1b).
--
-- 1. schools.feature_switches — a JSONB object of feature key -> boolean, set
--    only by the platform operator. Every school starts with '{}', which reads
--    as every feature OFF. Nothing in this migration turns anything on.
--    A JSONB column on `schools` (not a new table) because `schools` has no
--    RLS policy (it is the tenant table every policy keys off), so the
--    operator's cross-tenant read and write need no new SECURITY DEFINER
--    function. Keys are validated in code (FEATURE_KEYS in @school-kit/types);
--    the CHECK only guarantees the value is an object.
--
-- 2. platform_admin_list_schools() — 11th revision (DROP + CREATE, grants
--    restated), adds feature_switches so PATCH .../features is read back
--    rather than a blind write. Operator-set status about the tenancy, like
--    ai_enabled and smart_import_enabled.
--
-- SECURITY DEFINER count unchanged at 23.

ALTER TABLE "schools" ADD COLUMN "feature_switches" JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "schools" ADD CONSTRAINT "schools_feature_switches_object"
  CHECK (jsonb_typeof("feature_switches") = 'object');

-- -------------------------------------------------------------------------
-- 2. platform_admin_list_schools() — 11th revision
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
  students_on_roll         bigint,
  sms_sender_id            text,
  sms_sender_status        text,
  feature_switches         jsonb
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
        AND st.status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED')) AS students_on_roll,
    s.sms_sender_id              AS sms_sender_id,
    s.sms_sender_status::text    AS sms_sender_status,
    s.feature_switches           AS feature_switches
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
