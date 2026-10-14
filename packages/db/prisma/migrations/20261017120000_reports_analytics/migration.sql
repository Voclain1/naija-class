-- Phase 9 / CP1.2 — reports and analytics (docs/modules/phase-9.md §8).
--
-- The chronic-absence threshold is the school's own setting, so it lives on
-- `schools` (the tenant table; no RLS policy). Whole percent, 50–100,
-- default 90.
--
-- Also appends `reports.analytics.read` to the admin system role, kept IN
-- SYNC with packages/db/src/seeds/system-roles.ts (REPORTS_PERMISSIONS).
-- Owner is the wildcard; teacher and bursar get nothing (CP1-D6).
-- No new table and no SECURITY DEFINER function; the count stays 23.

ALTER TABLE "schools"
  ADD COLUMN "chronic_absence_threshold" INTEGER NOT NULL DEFAULT 90,
  ADD CONSTRAINT "schools_chronic_absence_threshold_range"
    CHECK ("chronic_absence_threshold" BETWEEN 50 AND 100);

UPDATE "roles"
SET "permissions" = "permissions" || (
  SELECT COALESCE(jsonb_agg(p), '[]'::jsonb)
  FROM jsonb_array_elements_text('["reports.analytics.read"]'::jsonb) AS p
  WHERE NOT ("roles"."permissions" @> jsonb_build_array(p))
)
WHERE "school_id" IS NULL
  AND "key" = 'admin'
  AND "is_system" = true;
