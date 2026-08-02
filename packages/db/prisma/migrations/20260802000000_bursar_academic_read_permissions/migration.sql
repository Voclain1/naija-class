-- Closes a Phase 3 / Slice 15 RBAC gap discovered 2026-08-02 while fixing
-- bursar's frontend shell access: bursar held every finance.* permission but
-- none of academic-year.read / term.read / class-arm.read, so every finance
-- page's year/term/class-arm selector (dashboard, invoice generation, invoice
-- list, debtors) 403'd for a real bursar account, even after the shell/nav
-- routing bug was fixed. bursar-scope.spec.ts's negative walk never exercised
-- these three endpoints, so the gap wasn't caught at Slice 15.
--
-- Read-only grant, mirroring the same "scoping context, not module access"
-- reasoning already used for the `teacher` role's class-arm.read/
-- class-level.read/etc. (20260728000000_teacher_grading_scheme_read_permission)
-- — bursar gets no academic-year/term/class-arm create/update/delete.
--
-- Keep in sync with PHASE_3_BURSAR_PERMISSIONS (packages/types/src/permissions.ts)
-- and the bursar seed in packages/db/src/seeds/system-roles.ts (fresh
-- `db:seed`); this migration covers existing/CI databases via `migrate deploy`.
--
-- Idempotent: NOT ... @> guard prevents duplicate JSON entries on re-run.

UPDATE "roles"
SET "permissions" = "permissions" || '["academic-year.read", "term.read", "class-arm.read"]'::jsonb
WHERE "school_id" IS NULL
  AND "key" = 'bursar'
  AND "is_system" = true
  AND NOT ("permissions" @> '["academic-year.read", "term.read", "class-arm.read"]'::jsonb);
