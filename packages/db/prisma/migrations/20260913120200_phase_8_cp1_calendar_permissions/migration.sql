-- Phase 8 / CP1 — Event Calendar permissions (docs/modules/phase-8.md §15 D28).
--
-- DATA migration (no schema diff). Idempotent APPEND per role, the same pattern
-- as 20260821000000_admin_dashboard_read_permission — restating each role's
-- full grant as a literal would be unreadable and a drift risk.
--
-- Kept IN SYNC with packages/db/src/seeds/system-roles.ts (fresh `db:seed`);
-- this covers existing and CI databases via `migrate deploy`. If you edit one,
-- edit both.
--
--   owner   — wildcard "*"; nothing to do.
--   admin   — manages the calendar: read, create, update, delete, hide.
--   teacher — read only.
--   bursar  — read only. D4: the calendar is visible to all users. This is the
--             one non-finance grant bursar holds, recorded as deliberate.

UPDATE "roles"
SET "permissions" = "permissions" || (
  SELECT COALESCE(jsonb_agg(p), '[]'::jsonb)
  FROM jsonb_array_elements_text(
    '["calendar-event.read","calendar-event.create","calendar-event.update","calendar-event.delete","national-event.hide"]'::jsonb
  ) AS p
  WHERE NOT ("roles"."permissions" @> jsonb_build_array(p))
)
WHERE "school_id" IS NULL
  AND "key" = 'admin'
  AND "is_system" = true;

UPDATE "roles"
SET "permissions" = "permissions" || '["calendar-event.read"]'::jsonb
WHERE "school_id" IS NULL
  AND "key" IN ('teacher', 'bursar')
  AND "is_system" = true
  AND NOT ("permissions" @> '["calendar-event.read"]'::jsonb);
