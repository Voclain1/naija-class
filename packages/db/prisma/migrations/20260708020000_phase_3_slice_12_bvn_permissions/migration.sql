-- Phase 3 / Slice 12 — Grant staff-bvn.* permissions to admin role
--
-- staff-bvn.manage-others / staff-bvn.read / staff-bvn.reveal are added to
-- PHASE_3_PERMISSIONS in packages/types/src/permissions.ts. Fresh installs
-- pick them up from the system-roles seed. This migration brings existing
-- deployed DBs in sync.
--
-- Owner + admin only — bursar is NOT granted (mirrors payment.refund: BVN
-- reveal is the highest-trust read in the payroll surface). The /users/me/bvn*
-- self-service routes need no permission string at all — every authenticated
-- user manages their own BVN regardless of role.
--
-- Idempotent: NOT ... @> guard prevents duplicate JSON entries on re-run.

UPDATE "roles"
SET "permissions" = "permissions" || '["staff-bvn.manage-others", "staff-bvn.read", "staff-bvn.reveal"]'::jsonb
WHERE "key" = 'admin'
  AND "is_system" = true
  AND NOT ("permissions" @> '["staff-bvn.manage-others"]'::jsonb);
