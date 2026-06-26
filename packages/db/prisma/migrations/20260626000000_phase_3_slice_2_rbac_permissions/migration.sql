-- Phase 3 Slice 2: add Phase 3 permissions to the system admin role.
--
-- auth.2fa.manage is owner-only (owner has '*' wildcard — no explicit grant
-- needed). auth.2fa.read is granted to admin so they can view 2FA status on
-- the user list without being able to enrol/disable their own 2FA.
--
-- Safe to re-run: the NOT ... ANY guard prevents duplicate array entries.
-- Runs as school_kit (BYPASSRLS), so no SET LOCAL app.current_school_id
-- needed — system roles have school_id = NULL and are read by the app
-- via basePrisma (pre-tenant).

UPDATE "roles"
SET "permissions" = array_append("permissions", 'auth.2fa.read')
WHERE "key" = 'admin'
  AND "is_system" = true
  AND NOT ('auth.2fa.read' = ANY("permissions"));
