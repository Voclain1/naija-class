-- =========================================================================
-- platform_admin_list_schools() — return shape extended (6th revision)
-- =========================================================================
--
-- Platform-admin tools, slice 1 (docs/modules/platform-admin.md). Adds three
-- columns. Same DROP + CREATE as every earlier revision: a SECURITY DEFINER
-- function's return columns cannot be changed by CREATE OR REPLACE, and the
-- drop resets the grants, so they are restated at the bottom.
--
-- This changes the shape of an existing function and adds none — the
-- SECURITY DEFINER count stays at 23, next review still due at 26.
--
-- New columns, and why each clears the omissions column in CLAUDE.md's
-- inventory row (which this migration revisits EXPLICITLY, rather than
-- silently reversing):
--
--   slug                     — the school's URL key. Previously omitted as
--                              "not basic metadata". Reversed here because two
--                              production schools share a name ("Virgo Fidelis
--                              Montessori School", docs/deferred.md) and this
--                              roster is the list an operator picks a school
--                              from before a write. The slug is the one
--                              human-readable field that tells them apart. It
--                              is not sensitive: slugs are public (students
--                              type their school's slug to sign in).
--
--   ai_monthly_token_budget  — the per-school AI spend cap in tokens, NULL
--                              meaning "the platform default". Previously
--                              omitted as "spend configuration". Reversed
--                              because PATCH /platform-admin/schools/:id/
--                              ai-budget now sets it (until now that took a raw
--                              production UPDATE), and a write with no read is
--                              the blind-write gap ai_enabled and
--                              staff_mobile_enabled were each added to close.
--                              It is operator-set, not the school's own
--                              configuration: no school screen can change it.
--
--   has_owner                — TRUE when a staff account at the school holds
--                              the `owner` role. Lets the dashboard offer
--                              "resend owner invite" only where there is no
--                              owner yet — including after the invitation has
--                              EXPIRED, which owner_invite_pending (unexpired
--                              only) cannot show. A boolean about the tenancy;
--                              it names nobody.
--
-- Still omitted, unchanged: address, phone, email, primaryColor, logoUrl,
-- onboardingStep, ndprConsent, Paystack fields, parent_summary_enabled.

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
  staff_mobile_enabled     boolean
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
