-- Promotion engine — permissions (docs/modules/promotion-engine.md D8).
--
-- DATA migration. Idempotent APPEND to the admin system role (the
-- 20260914140100_phase_8_cp3_timetable_permissions pattern). Kept IN SYNC with
-- packages/db/src/seeds/system-roles.ts.
--
--   owner            — wildcard; nothing to do.
--   admin            — promotion.read, promotion.commit.
--   teacher, bursar  — NEITHER. One commit writes an enrollment for every
--                      student in the school; that is an owner/admin act.

UPDATE "roles"
SET "permissions" = "permissions" || (
  SELECT COALESCE(jsonb_agg(p), '[]'::jsonb)
  FROM jsonb_array_elements_text('["promotion.read","promotion.commit"]'::jsonb) AS p
  WHERE NOT ("roles"."permissions" @> jsonb_build_array(p))
)
WHERE "school_id" IS NULL
  AND "key" = 'admin'
  AND "is_system" = true;
