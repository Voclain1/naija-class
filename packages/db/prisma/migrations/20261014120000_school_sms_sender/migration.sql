-- The school's own SMS sender name (2026-10-11,
-- docs/modules/school-identity.md slice 2).
--
-- 1. "SmsSenderStatus" enum and four columns on schools: the name the school
--    asked for, its status, and when it was asked for and decided. A school
--    asks; the platform operator submits it to the networks and records the
--    outcome. Only APPROVED is ever used to send. The name is 3 to 11 letters
--    and digits with at least one letter, the networks' rule for an
--    alphanumeric sender.
--
-- 2. platform_admin_list_schools() — 10th revision (DROP + CREATE, grants
--    restated), adds sms_sender_id and sms_sender_status, so
--    PATCH .../sms-sender is read back and the operator sees every request.
--    Operator-decided status about the tenancy, like smart_import_enabled.
--    The sender name is public by nature: it is shown on every SMS sent.
--
-- SECURITY DEFINER count unchanged at 23.

CREATE TYPE "SmsSenderStatus" AS ENUM ('NONE', 'REQUESTED', 'APPROVED', 'REJECTED');

ALTER TABLE "schools" ADD COLUMN "sms_sender_id" TEXT;
ALTER TABLE "schools" ADD COLUMN "sms_sender_status" "SmsSenderStatus" NOT NULL DEFAULT 'NONE';
ALTER TABLE "schools" ADD COLUMN "sms_sender_requested_at" TIMESTAMP(3);
ALTER TABLE "schools" ADD COLUMN "sms_sender_decided_at" TIMESTAMP(3);
ALTER TABLE "schools" ADD CONSTRAINT "schools_sms_sender_id_format"
  CHECK ("sms_sender_id" IS NULL OR "sms_sender_id" ~ '^(?=.*[A-Za-z])[A-Za-z0-9]{3,11}$');
-- A status other than NONE always has a name to be about.
ALTER TABLE "schools" ADD CONSTRAINT "schools_sms_sender_has_id"
  CHECK ("sms_sender_status" = 'NONE' OR "sms_sender_id" IS NOT NULL);

-- -------------------------------------------------------------------------
-- 2. platform_admin_list_schools() — 10th revision
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
  sms_sender_status        text
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
    s.sms_sender_status::text    AS sms_sender_status
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
