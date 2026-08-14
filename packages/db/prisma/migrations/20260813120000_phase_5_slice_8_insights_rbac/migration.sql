-- Phase 5 / Slice 8 — admin insights RBAC rollup.
--
-- No schema change: insights are computed live from assessments, attendance
-- records and enrollments that already exist. There is no insights table and
-- no cache, deliberately — a pre-computed weekly snapshot (which
-- ARCHITECTURE §7 floats) would need its own staleness story, and a head
-- teacher asking "which classes are struggling" on a Wednesday wants
-- Wednesday's answer. Revisit if the live queries get slow at real roll sizes.
--
-- One permission, `insight.read`, granted to admin only. Owner already holds
-- '*'. TEACHER IS DELIBERATELY EXCLUDED: these reports rank class arms and
-- subjects against each other across the whole school, which is management
-- information about colleagues' work, not teaching workflow. A teacher's own
-- arm is already visible to them through the gradebook and report cards.
--
-- packages/db/src/seeds/system-roles.ts derives from PHASE_5_PERMISSIONS, so a
-- fresh `pnpm db:seed` matches this UPDATE without a separate edit.

UPDATE "roles"
SET "permissions" = "permissions" || '["insight.read"]'::jsonb
WHERE "key" = 'admin'
  AND "is_system" = true
  AND NOT ("permissions" @> '["insight.read"]'::jsonb);
