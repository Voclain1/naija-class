-- Phase 8 / CP4 — the teacher's own timetable (docs/modules/phase-8.md §18 D38).
--
-- DATA migration. Idempotent APPEND to the teacher system role (the
-- 20260914140100_phase_8_cp3_timetable_permissions pattern). Kept IN SYNC with
-- packages/db/src/seeds/system-roles.ts.
--
--   teacher — timetable.own.read (own lessons + form-class grids, service-scoped).
--   owner   — wildcard; nothing to do.
--   admin, bursar — NOT granted: owner/admin use the builder (timetable.read);
--            bursar has no timetable surface.

UPDATE "roles"
SET "permissions" = "permissions" || (
  SELECT COALESCE(jsonb_agg(p), '[]'::jsonb)
  FROM jsonb_array_elements_text('["timetable.own.read"]'::jsonb) AS p
  WHERE NOT ("roles"."permissions" @> jsonb_build_array(p))
)
WHERE "school_id" IS NULL
  AND "key" = 'teacher'
  AND "is_system" = true;
