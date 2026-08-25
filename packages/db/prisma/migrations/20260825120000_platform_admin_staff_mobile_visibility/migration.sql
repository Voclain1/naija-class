-- =========================================================================
-- platform_admin_list_schools() — return shape extended (5th revision)
-- =========================================================================
--
-- Adds staff_mobile_enabled. Without it, PATCH /platform-admin/schools/
-- :schoolId/staff-mobile (shipped 2026-08-24, PR #211) is a blind write: the
-- operator can turn staff mobile on or off for a school and has no read path
-- to confirm what happened. Exactly the gap the 2026-08-14 revision closed for
-- ai_enabled, closed here for the same reason and in the same shape.
--
-- WHY THIS IS NOT MERELY COSMETIC. The enable direction had an accidental
-- substitute: a successful staff mobile login proves the flag is true, because
-- School.staff_mobile_enabled is re-read from the row at BOTH password
-- acceptance and 2FA challenge completion, and a false value returns
-- 403 STAFF_MOBILE_DISABLED. The DISABLE direction has no such substitute —
-- "nobody could log in" is not an observation anyone can make, and a failed
-- disable looks identical to a successful one from outside. A kill switch
-- verifiable in only the direction that grants access, and not in the
-- direction that removes it, is the wrong way round. This migration is what
-- makes a disable checkable.
--
-- Same DROP + CREATE dance as the 2026-08-07, 2026-08-09 and 2026-08-14
-- revisions: a SECURITY DEFINER function's return columns cannot be changed
-- by CREATE OR REPLACE.
--
-- This is a shape change to an existing function, NOT a new function — the
-- SECURITY DEFINER count stays at 20. The next table-shape review remains due
-- at 23 (the +3 cadence review was carried out at 20 on 2026-08-16).
--
-- Scope note: CLAUDE.md's inventory row for this function lists what it
-- deliberately omits — "slug, address, phone, email, primaryColor, logoUrl,
-- onboardingStep, ndprConsent, Paystack fields ... financial/config detail is
-- out of this surface's scope." staff_mobile_enabled is not a violation, on
-- precisely the reasoning early_access_granted_at and ai_enabled were both
-- cleared under: it is platform status ABOUT the tenancy — set by the platform
-- operator during a one-school-at-a-time rollout, the same category as
-- is_active and owner_invite_pending — and not the school's own configuration.
-- The school cannot set it, and nothing in the school's own settings surface
-- exposes it.
--
-- No schema change and no backfill. School.staff_mobile_enabled already exists
-- with DEFAULT false (20260824120000_staff_mobile_auth_foundation), and that
-- default is the rollout posture: off everywhere until an operator turns it on
-- for one reviewed school.
--
-- Returns (one row per school) — unchanged columns keep their prior meaning
-- (see 20260802000000_platform_admin,
-- 20260807000000_platform_admin_school_provisioning,
-- 20260809000000_add_school_early_access_granted_at and
-- 20260814000000_platform_admin_ai_toggle); new column:
--   staff_mobile_enabled — the per-school staff mobile rollout gate. TRUE
--                          means staff of this school may hold a mobile
--                          session at all. It says nothing about which staff:
--                          role grants and the per-principal guards are
--                          separate, unrelated gates.

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
  owner_invite_expires_at  timestamp(3),
  early_access_granted_at  timestamp(3),
  ai_enabled               boolean,
  staff_mobile_enabled     boolean
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
    oi.expires_at                AS owner_invite_expires_at,
    s.early_access_granted_at    AS early_access_granted_at,
    s.ai_enabled                 AS ai_enabled,
    s.staff_mobile_enabled       AS staff_mobile_enabled
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
