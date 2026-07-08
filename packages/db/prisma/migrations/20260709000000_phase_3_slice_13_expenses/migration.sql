-- Phase 3 / Slice 13 — Expense tracking
--
-- Creates expense_categories and expenses tables with FORCE RLS tenant
-- isolation. Structurally mirrors the slice-4 fee_categories/fee_items
-- migration, with one deliberate difference: expenses.category_id gets NO
-- FOREIGN KEY constraint (plain FK, same convention as fee_items' scope
-- columns — class_level_id/class_arm_id/term_id/academic_year_id — none of
-- which get a FK either). This is the opposite of fee_items.category_id,
-- which DOES have an enforced FK — see the schema.prisma header comment on
-- the Expense model for the service-layer consequences (no Prisma `_count`
-- shorthand for the delete guard; categoryId existence validated in the
-- service, not the DB).
--
-- app_user grants: ALTER DEFAULT PRIVILEGES (slice 1 Neon setup) auto-grants
-- SELECT/INSERT/UPDATE/DELETE on every future table created by school_kit to
-- app_user — no manual GRANT needed here.

-- ─────────────────────────────────────────────────────────────────────────────
-- expense_categories
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "expense_categories" (
  "id"          TEXT          NOT NULL,
  "school_id"   TEXT          NOT NULL,
  "name"        TEXT          NOT NULL,
  "active"      BOOLEAN       NOT NULL DEFAULT true,
  "created_at"  TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3)  NOT NULL,

  CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- Unique name per school (school-defined taxonomy; names must not collide).
CREATE UNIQUE INDEX "expense_categories_school_id_name_key"
  ON "expense_categories" ("school_id", "name");

CREATE INDEX "expense_categories_school_id_idx"
  ON "expense_categories" ("school_id");

ALTER TABLE "expense_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "expense_categories" FORCE  ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "expense_categories"
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

-- ─────────────────────────────────────────────────────────────────────────────
-- expenses
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "expenses" (
  "id"           TEXT          NOT NULL,
  "school_id"    TEXT          NOT NULL,
  "category_id"  TEXT          NOT NULL, -- plain FK, no constraint — see header
  "amount"       INTEGER       NOT NULL,
  "description"  TEXT,
  "incurred_at"  DATE          NOT NULL,
  "receipt_url"  TEXT,
  "recorded_by"  TEXT          NOT NULL,
  "created_at"   TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3)  NOT NULL,

  CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "expenses_school_id_incurred_at_idx"
  ON "expenses" ("school_id", "incurred_at");

CREATE INDEX "expenses_school_id_category_id_idx"
  ON "expenses" ("school_id", "category_id");

ALTER TABLE "expenses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "expenses" FORCE  ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "expenses"
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

-- ─────────────────────────────────────────────────────────────────────────────
-- RBAC: add expense-tracking permissions to the system admin role
-- ─────────────────────────────────────────────────────────────────────────────
--
-- expense-category.* and expense.* are granted to admin — no owner-only
-- restriction (unlike payment.refund/staff-bvn.reveal, this isn't a
-- highest-trust surface). Bursar wire-up deferred to slice 15, same as every
-- other Phase 3 permission bucket. Owner has the '*' wildcard.
-- Idempotent: NOT ... @> guard prevents duplicate JSON entries.

UPDATE "roles"
SET "permissions" = "permissions" || '["expense-category.read","expense-category.create","expense-category.update","expense-category.delete","expense.read","expense.create","expense.update","expense.delete"]'::jsonb
WHERE "key" = 'admin'
  AND "is_system" = true
  AND NOT ("permissions" @> '["expense-category.read"]'::jsonb);
