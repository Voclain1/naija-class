-- Early-access marker for future paid-tier grandfathering (2026-08-09).
--
-- Nullable stamp, no enforcement logic anywhere in the application — this
-- migration deliberately ships the flag ONLY. See schema.prisma's
-- School.earlyAccessGrantedAt header comment for why created_at is not an
-- adequate substitute, and docs/deferred.md "Pricing / tier enforcement" for
-- the open decisions this is buying time on.
--
-- No backfill here on purpose. Which existing schools count as early-access
-- is a judgement call for the platform admin, made from the super-admin
-- school list, not something a migration should guess — especially while the
-- production database is still mostly smoke-test artifacts (see the
-- smoke-school cleanup wired into deploy-staging.yml in the same PR).

ALTER TABLE "schools" ADD COLUMN "early_access_granted_at" TIMESTAMP(3);

-- =========================================================================
-- platform_admin_list_schools() — return shape extended (3rd revision)
-- =========================================================================
--
-- Adds early_access_granted_at so the super-admin school list can show and
-- set the flag. Same DROP + CREATE dance as the 2026-08-07 revision: a
-- SECURITY DEFINER function's return columns cannot be changed by
-- CREATE OR REPLACE.
--
-- This is a shape change to an existing function, NOT a new function — the
-- SECURITY DEFINER count stays at 16. (The table-shape review triggered at
-- 8 and still outstanding at 16 is tracked in docs/deferred.md; this PR does
-- not resolve it either.)
--
-- Scope note: CLAUDE.md's inventory row for this function lists what it
-- deliberately omits — "slug, address, phone, email, primaryColor, logoUrl,
-- onboardingStep, ndprConsent, Paystack fields ... financial/config detail is
-- out of this surface's scope." early_access_granted_at is NOT a violation of
-- that: it is commercial *status* about the tenancy itself (the same category
-- as is_active and owner_invite_pending, both already returned), not the
-- school's own financial configuration. It exposes no payout details, no
-- amounts, and no student PII.
--
-- Returns (one row per school) — unchanged columns keep their prior meaning
-- (see 20260802000000_platform_admin and
-- 20260807000000_platform_admin_school_provisioning); new column:
--   early_access_granted_at — timestamp(3) the school was marked early-access,
--                             NULL when it never was. NULL is the default and
--                             the overwhelming majority case.

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
  early_access_granted_at  timestamp(3)
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
    s.early_access_granted_at    AS early_access_granted_at
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
