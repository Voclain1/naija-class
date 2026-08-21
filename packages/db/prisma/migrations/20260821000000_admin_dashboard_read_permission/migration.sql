-- Closes a gap the admin-dashboard initiative left open: the `admin` system
-- role has NEVER held `dashboard.read`.
--
-- ADMIN_DASHBOARD_PERMISSIONS (packages/types/src/permissions.ts) was spliced
-- into ALL_PERMISSIONS when the dashboard shipped, and DashboardController
-- guards GET /dashboard with @Permissions("dashboard.read") — but the
-- permission was never added to ADMIN_PERMISSIONS in
-- packages/db/src/seeds/system-roles.ts, and no migration granted it. Owners
-- are unaffected (their grant is the "*" wildcard); every INVITED ADMIN has
-- been unable to load the dashboard they are routed to at login
-- (home-route.ts sends owner/admin to /dashboard).
--
-- WHY IT WAS INVISIBLE UNTIL NOW, which is the interesting part: the admin
-- dashboard page only calls the API once it has a termId
-- ("if (!termId) return;" in (admin)/dashboard/page.tsx), and termId comes
-- from the topbar's term selector. Schools had no terms — that is #198, the
-- bug this migration ships alongside — so the request was never made and the
-- missing permission never surfaced. Giving schools a real academic calendar
-- makes the call happen, which is what exposed the 403. The fix for #198 and
-- this grant therefore have to ship together: without it, closing #198 would
-- hand every invited admin a broken dashboard.
--
-- Found 2026-08-21 via the real e2e happy-path run (owner signs up ->
-- onboarding -> invites an admin -> admin accepts and logs in), which is the
-- only place an INVITED admin — rather than an owner — actually loads the
-- dashboard.
--
-- DATA migration (no schema diff). Idempotent APPEND rather than the
-- full-literal UPDATE the teacher/bursar migrations use: ADMIN_PERMISSIONS is
-- a ~138-entry composition of every phase array, so restating it as a literal
-- would be both unreadable and a drift risk. Same append pattern as
-- 20260820000000_smart_student_import. Kept IN SYNC with
-- ADMIN_PERMISSIONS in packages/db/src/seeds/system-roles.ts, which covers a
-- fresh `db:seed`; this covers existing/CI databases via `migrate deploy`.
-- If you edit one, edit both.

UPDATE "roles"
SET "permissions" = "permissions" || '["dashboard.read"]'::jsonb
WHERE "school_id" IS NULL
  AND "key" = 'admin'
  AND "is_system" = true
  AND NOT ("permissions" @> '["dashboard.read"]'::jsonb);
