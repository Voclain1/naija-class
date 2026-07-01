-- Phase 3 / Slice 7 — Grant payment permissions to admin role
--
-- payment.read / payment.record are added to PHASE_3_PERMISSIONS in
-- packages/types/src/permissions.ts. Fresh installs pick them up from the
-- system-roles seed (seed-data.ts derives admin permissions from that array).
-- This migration brings existing deployed DBs in sync.
--
-- payment.refund is intentionally absent — it lands in slice 11 alongside
-- the refund workflow. Bursar role wire-up deferred to slice 15.
--
-- Idempotent: NOT ... @> guard prevents duplicate JSON entries on re-run.

UPDATE "roles"
SET "permissions" = "permissions" || '["payment.read","payment.record"]'::jsonb
WHERE "key" = 'admin'
  AND "is_system" = true
  AND NOT ("permissions" @> '["payment.read"]'::jsonb);
