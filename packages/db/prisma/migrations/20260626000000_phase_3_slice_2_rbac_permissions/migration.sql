-- Phase 3 Slice 2: add Phase 3 permissions to the system admin role.
--
-- auth.2fa.manage is owner-only (owner has '*' wildcard — no explicit grant
-- needed). auth.2fa.read is granted to admin so they can view 2FA status on
-- the user list without being able to enrol/disable their own 2FA.
--
-- Safe to re-run: the NOT ... @> guard prevents duplicate entries.
-- Runs as school_kit (BYPASSRLS), so no SET LOCAL app.current_school_id
-- needed — system roles have school_id = NULL and are read by the app
-- via basePrisma (pre-tenant).
--
-- NOTE: roles.permissions is JSONB (Prisma Json type), not a native Postgres
-- array. Use JSONB containment (@>) and concatenation (||) — NOT array_append
-- or = ANY(), which require a native array type.

UPDATE "roles"
SET "permissions" = "permissions" || '["auth.2fa.read"]'::jsonb
WHERE "key" = 'admin'
  AND "is_system" = true
  AND NOT ("permissions" @> '["auth.2fa.read"]'::jsonb);
