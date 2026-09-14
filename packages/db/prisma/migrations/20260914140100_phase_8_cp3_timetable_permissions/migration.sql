-- Phase 8 / CP3 — Timetable permissions (docs/modules/phase-8.md §17 D35).
--
-- DATA migration. Idempotent APPEND to the admin system role (the
-- 20260821000000_admin_dashboard_read_permission pattern). Kept IN SYNC with
-- packages/db/src/seeds/system-roles.ts.
--
--   owner  — wildcard; nothing to do.
--   admin  — timetable.read, timetable.manage.
--   teacher, bursar — NEITHER in CP3. The whole-school grid names every
--            teacher's week; teacher read surfaces are CP4's, scoped.

UPDATE "roles"
SET "permissions" = "permissions" || (
  SELECT COALESCE(jsonb_agg(p), '[]'::jsonb)
  FROM jsonb_array_elements_text('["timetable.read","timetable.manage"]'::jsonb) AS p
  WHERE NOT ("roles"."permissions" @> jsonb_build_array(p))
)
WHERE "school_id" IS NULL
  AND "key" = 'admin'
  AND "is_system" = true;
