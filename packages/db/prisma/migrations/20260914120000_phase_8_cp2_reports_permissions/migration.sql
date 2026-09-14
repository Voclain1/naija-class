-- Phase 8 / CP2 — Recording Completeness permissions (docs/modules/phase-8.md §16 D39).
--
-- DATA migration (no schema diff). Idempotent APPEND to the admin system role,
-- the same pattern as 20260821000000_admin_dashboard_read_permission.
--
-- Kept IN SYNC with packages/db/src/seeds/system-roles.ts (fresh `db:seed`);
-- this covers existing and CI databases via `migrate deploy`. Edit both or
-- neither.
--
--   owner   — wildcard "*"; nothing to do.
--   admin   — both permissions.
--   teacher, bursar — NEITHER. The teacher-activity view names colleagues'
--             recording work (§4.4, §3.4 D22); the completeness report is
--             operator information.
--
-- No new tables and no RLS change: CP2 reads existing tables inside withTenant.

UPDATE "roles"
SET "permissions" = "permissions" || (
  SELECT COALESCE(jsonb_agg(p), '[]'::jsonb)
  FROM jsonb_array_elements_text(
    '["reports.completeness.read","reports.teacher-activity.read"]'::jsonb
  ) AS p
  WHERE NOT ("roles"."permissions" @> jsonb_build_array(p))
)
WHERE "school_id" IS NULL
  AND "key" = 'admin'
  AND "is_system" = true;
