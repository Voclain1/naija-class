-- Phase 3 / Slice 15 — `bursar` role wire-up + RBAC close-out.
--
-- Brand-new system role row (school_id IS NULL, is_system = true), NOT an
-- update to an existing row — unlike the slice 11 (payment.refund) and
-- slice 12 (staff-bvn.*) migrations, which patched the already-seeded admin
-- row via jsonb `||`. Idempotent the same way slice 10's teacher-role
-- migration is: roles(school_id, key) treats NULL school_id as DISTINCT in
-- Postgres, so ON CONFLICT cannot dedupe a NULL-school row — guard with
-- WHERE NOT EXISTS instead. Fresh installs get this row via
-- packages/db/src/seeds/system-roles.ts + `pnpm db:seed`; this migration
-- brings already-provisioned/CI DBs in sync.
--
-- Permissions = PHASE_3_BURSAR_PERMISSIONS (packages/types/src/permissions.ts):
-- fee catalog, discount rules, invoices, payments (not refunds), payment
-- plans, debtor reminders, expenses, and the finance dashboard. No academic,
-- roster, staff, or school-settings access. Deliberately excludes
-- auth.2fa.*, staff-bvn.*, payment.refund, and every Phase 0/1/2 permission.
-- Keep in sync with PHASE_3_BURSAR_PERMISSIONS and system-roles.ts — if you
-- edit one, edit all three.

INSERT INTO "roles" ("id", "school_id", "key", "name", "description", "is_system", "permissions", "created_at")
SELECT
    gen_random_uuid()::text,
    NULL,
    'bursar',
    'Bursar',
    'Finance operator — fee catalog, discounts, invoices, payments (excluding refunds), payment plans, debtor reminders, expenses, and the finance dashboard. No academic, roster, staff, or school-settings access. Phase 3 slice 15 RBAC close-out.',
    true,
    '["fee-category.read","fee-category.create","fee-category.update","fee-category.delete","fee-item.read","fee-item.create","fee-item.update","fee-item.delete","discount-rule.read","discount-rule.create","discount-rule.update","discount-rule.deactivate","invoice.read","invoice.issue","invoice.cancel","payment.read","payment.record","payment-plan.create","payment-plan.read","payment-plan.delete","finance.debtors.read","finance.debtors.remind","expense-category.read","expense-category.create","expense-category.update","expense-category.delete","expense.read","expense.create","expense.update","expense.delete","finance.dashboard.read"]'::jsonb,
    CURRENT_TIMESTAMP
WHERE NOT EXISTS (
    SELECT 1 FROM "roles"
    WHERE "school_id" IS NULL AND "key" = 'bursar' AND "is_system" = true
);
