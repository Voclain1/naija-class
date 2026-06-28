-- Phase 3 / Slice 4 — Fee catalog
--
-- Creates fee_categories and fee_items tables with FORCE RLS tenant isolation,
-- then adds fee-category.* and fee-item.* permission strings to the system
-- admin role.
--
-- app_user grants: ALTER DEFAULT PRIVILEGES was executed as school_kit during
-- the slice 1 Neon setup (neon-prod-setup.md §1b). That command auto-grants
-- SELECT, INSERT, UPDATE, DELETE on every future table created by school_kit to
-- app_user — no manual GRANT is needed here or for any subsequent migration.
-- (The one-time explicit re-grant in §4 of that runbook covered pre-existing
-- tables only; it is not a recurring step.)

-- ─────────────────────────────────────────────────────────────────────────────
-- fee_categories
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "fee_categories" (
  "id"          TEXT          NOT NULL,
  "school_id"   TEXT          NOT NULL,
  "name"        TEXT          NOT NULL,
  "description" TEXT,
  "active"      BOOLEAN       NOT NULL DEFAULT true,
  "created_by"  TEXT          NOT NULL,
  "created_at"  TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3)  NOT NULL,

  CONSTRAINT "fee_categories_pkey" PRIMARY KEY ("id")
);

-- Unique name per school (school-defined taxonomy; names must not collide).
CREATE UNIQUE INDEX "fee_categories_school_id_name_key"
  ON "fee_categories" ("school_id", "name");

CREATE INDEX "fee_categories_school_id_idx"
  ON "fee_categories" ("school_id");

ALTER TABLE "fee_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fee_categories" FORCE  ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "fee_categories"
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

-- ─────────────────────────────────────────────────────────────────────────────
-- fee_items
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "fee_items" (
  "id"               TEXT          NOT NULL,
  "school_id"        TEXT          NOT NULL,
  "category_id"      TEXT          NOT NULL,
  "name"             TEXT          NOT NULL,
  "amount"           INTEGER       NOT NULL,
  "class_level_id"   TEXT,
  "class_arm_id"     TEXT,
  "term_id"          TEXT,
  "academic_year_id" TEXT,
  "active"           BOOLEAN       NOT NULL DEFAULT true,
  "created_by"       TEXT          NOT NULL,
  "created_at"       TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3)  NOT NULL,

  CONSTRAINT "fee_items_pkey" PRIMARY KEY ("id")
);

-- Enforced FK to fee_categories: deleting a category is blocked while items
-- reference it (Restrict). The four scope columns (class_level_id, class_arm_id,
-- term_id, academic_year_id) follow the project's plain-FK convention —
-- validated at the service layer, not enforced here.
ALTER TABLE "fee_items"
  ADD CONSTRAINT "fee_items_category_id_fkey"
  FOREIGN KEY ("category_id")
  REFERENCES "fee_categories" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "fee_items_school_id_idx"
  ON "fee_items" ("school_id");

-- Non-unique scan index for invoice generation (slice 6). A school can have
-- many fee items with the same scope combination (e.g. two hostel tiers for
-- JSS1 First Term), so this MUST NOT be UNIQUE.
CREATE INDEX "fee_items_school_id_level_term_year_idx"
  ON "fee_items" ("school_id", "class_level_id", "term_id", "academic_year_id");

ALTER TABLE "fee_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fee_items" FORCE  ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "fee_items"
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

-- ─────────────────────────────────────────────────────────────────────────────
-- RBAC: add fee-catalog permissions to the system admin role
-- ─────────────────────────────────────────────────────────────────────────────
--
-- fee-category.* and fee-item.* are granted to admin (no owner-only restriction
-- in this slice; billing.delete owner-only gates land at slice 15 close-out).
-- Owner has the '*' wildcard — no explicit entry needed.
-- Idempotent: NOT ... @> guard prevents duplicate JSON entries.
-- roles.permissions is JSONB — use || concatenation and @> containment, not
-- array_append or = ANY() (those require a native Postgres array type).

UPDATE "roles"
SET "permissions" = "permissions" || '["fee-category.read","fee-category.create","fee-category.update","fee-category.delete","fee-item.read","fee-item.create","fee-item.update","fee-item.delete"]'::jsonb
WHERE "key" = 'admin'
  AND "is_system" = true
  AND NOT ("permissions" @> '["fee-category.read"]'::jsonb);
