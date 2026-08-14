-- =========================================================================
-- platform_admin_list_schools() — return shape extended (4th revision)
-- =========================================================================
--
-- Adds ai_enabled so the super-admin school list can SHOW which schools have
-- AI on, and the new PATCH /platform-admin/schools/:schoolId/ai endpoint has
-- something to toggle against. Without this column the endpoint would be a
-- blind write: an operator rolling AI out one school at a time could not see
-- the current state of the population they are rolling out to.
--
-- Same DROP + CREATE dance as the 2026-08-07 and 2026-08-09 revisions: a
-- SECURITY DEFINER function's return columns cannot be changed by
-- CREATE OR REPLACE.
--
-- This is a shape change to an existing function, NOT a new function — the
-- SECURITY DEFINER count stays at 16. (The table-shape review triggered at 8
-- and still outstanding at 16 is tracked in docs/deferred.md; this migration
-- does not resolve it either.)
--
-- Scope note: CLAUDE.md's inventory row for this function lists what it
-- deliberately omits — "slug, address, phone, email, primaryColor, logoUrl,
-- onboardingStep, ndprConsent, Paystack fields ... financial/config detail is
-- out of this surface's scope." ai_enabled is NOT a violation of that, on the
-- same reasoning early_access_granted_at was cleared under: it is platform
-- status about the tenancy (the same category as is_active and
-- owner_invite_pending, both already returned), set by the platform operator
-- rather than by the school. Note what is still NOT returned:
-- ai_monthly_token_budget and parent_summary_enabled are the school's own AI
-- configuration and stay out — a per-school budget is spend configuration,
-- and parentSummaryEnabled is a school's own opt-in decision (schema.prisma
-- is explicit that it is deliberately not aiEnabled's twin). Neither is
-- needed to answer "is AI on for this school".
--
-- No schema change and no backfill here. School.ai_enabled already exists
-- (Phase 5 / Slice 1 CP2) and keeps its @default(true) — that default is a
-- considered decision documented in schema.prisma, and changing it is a
-- product call, not this migration's business. The one-off disabling of the
-- existing population is
-- packages/db/scripts/disable-ai-per-school.ts, deliberately a script rather
-- than a migration: it is an operational rollout step that must be dry-run,
-- audited per school, and reversible one school at a time — none of which a
-- migration can offer.
--
-- Returns (one row per school) — unchanged columns keep their prior meaning
-- (see 20260802000000_platform_admin,
-- 20260807000000_platform_admin_school_provisioning and
-- 20260809000000_add_school_early_access_granted_at); new column:
--   ai_enabled — the per-school AI kill switch. TRUE means every AI feature
--                is available to the school SUBJECT TO the platform-wide
--                AI_ENABLED env var, which is a separate gate this column
--                says nothing about.

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
  ai_enabled               boolean
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
    s.ai_enabled                 AS ai_enabled
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
