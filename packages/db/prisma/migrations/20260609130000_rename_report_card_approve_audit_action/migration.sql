-- Phase 2 / Slice 9 cp2 — rename the principal-approve audit action.
--
-- DATA migration (no schema diff). The report-card approval transition wrote
-- audit action "report-card.approve", which diverged from its @Permissions key
-- + the spec's audit-action list ("report-card.principal-approve"). Audit
-- action strings should match permission names — the divergence was a trip
-- hazard. The workflow service now writes the canonical name; this rewrites
-- existing rows (dev + CI) so the history is consistent.
--
-- Idempotent: re-running matches zero rows once the rename has applied.

UPDATE "audit_logs"
SET "action" = 'report-card.principal-approve'
WHERE "action" = 'report-card.approve';
