-- Phase 3 / Slice 6 — Grant invoice permissions to admin role
--
-- invoice.read / invoice.issue / invoice.cancel are added to PHASE_3_PERMISSIONS
-- in packages/types/src/permissions.ts. The system-roles seed already derives
-- admin permissions from that array, so fresh installs need no change. This
-- migration brings the existing global admin role row in sync for deployed DBs.
--
-- invoice.cancel is intentionally included for admin (not owner-only) — cancelling
-- an issued invoice is a finance operation, not a history-bearing hard delete.
-- `billing.delete` (the future owner-only finance hard-delete) is deferred to
-- slice 15 alongside the bursar role wire-up.
--
-- Idempotent: NOT ... @> guard prevents duplicate JSON entries on re-run.

UPDATE "roles"
SET "permissions" = "permissions" || '["invoice.read","invoice.issue","invoice.cancel"]'::jsonb
WHERE "key" = 'admin'
  AND "is_system" = true
  AND NOT ("permissions" @> '["invoice.read"]'::jsonb);
