-- Phase 9 / CP1.3 — `export.table` (docs/modules/phase-9.md §8.9 CP1-D10).
--
-- DATA migration (no schema diff). Idempotent APPEND to the admin, teacher
-- and bursar system roles; owner is the wildcard. Kept IN SYNC with
-- packages/db/src/seeds/system-roles.ts (TABLE_EXPORT_PERMISSIONS).
--
-- It grants no data: the server lays out rows the page already holds and
-- reads nothing. No table and no SECURITY DEFINER function; the count stays 23.

UPDATE "roles"
SET "permissions" = "permissions" || (
  SELECT COALESCE(jsonb_agg(p), '[]'::jsonb)
  FROM jsonb_array_elements_text('["export.table"]'::jsonb) AS p
  WHERE NOT ("roles"."permissions" @> jsonb_build_array(p))
)
WHERE "school_id" IS NULL
  AND "key" IN ('admin', 'teacher', 'bursar')
  AND "is_system" = true;
