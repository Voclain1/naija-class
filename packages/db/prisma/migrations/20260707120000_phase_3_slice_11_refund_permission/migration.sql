-- Phase 3 / Slice 11 — Grant payment.refund permission to admin role
--
-- payment.refund is added to PHASE_3_PERMISSIONS in
-- packages/types/src/permissions.ts. Fresh installs pick it up from the
-- system-roles seed. This migration brings existing deployed DBs in sync.
--
-- payment.refund is owner + admin only (bursar excluded — highest-trust mutation).
-- Bursar role wire-up is deferred to slice 15.
--
-- Idempotent: NOT ... @> guard prevents duplicate JSON entries on re-run.

UPDATE "roles"
SET "permissions" = "permissions" || '["payment.refund"]'::jsonb
WHERE "key" = 'admin'
  AND "is_system" = true
  AND NOT ("permissions" @> '["payment.refund"]'::jsonb);
