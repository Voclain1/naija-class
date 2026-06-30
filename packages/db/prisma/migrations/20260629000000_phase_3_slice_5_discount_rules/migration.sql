-- Phase 3 / Slice 5 — Discount rules
--
-- Creates discount_rules table with FORCE RLS tenant isolation, then adds
-- discount-rule.* permission strings to the system admin role.
--
-- app_user grants: ALTER DEFAULT PRIVILEGES was executed as school_kit during
-- the slice 1 Neon setup. That command auto-grants SELECT, INSERT, UPDATE,
-- DELETE on every future table created by school_kit to app_user — no manual
-- GRANT is needed here (same pattern as slice 4).

-- ─────────────────────────────────────────────────────────────────────────────
-- Enums
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "DiscountDuration" AS ENUM ('TERM', 'SESSION', 'LIFETIME');
CREATE TYPE "DiscountType" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT', 'FULL_WAIVER');

-- ─────────────────────────────────────────────────────────────────────────────
-- discount_rules
-- ─────────────────────────────────────────────────────────────────────────────
--
-- All FK columns (student_id, fee_item_id, fee_category_id, term_id,
-- academic_year_id) follow the plain-FK convention — validated at the service
-- layer via withTenant, not enforced at the DB layer. This avoids cross-module
-- FK fragility (fee_items and students live in different modules; discounts
-- must survive a future restructuring without cascading constraint failures).
--
-- value semantics:
--   PERCENTAGE   → basis points (Int, 1–9999)
--   FIXED_AMOUNT → kobo (Int, positive)
--   FULL_WAIVER  → NULL (service enforces null on create)

CREATE TABLE "discount_rules" (
  "id"               TEXT              NOT NULL,
  "school_id"        TEXT              NOT NULL,
  "student_id"       TEXT              NOT NULL,
  "name"             TEXT              NOT NULL,
  "fee_item_id"      TEXT,
  "fee_category_id"  TEXT,
  "duration"         "DiscountDuration" NOT NULL,
  "term_id"          TEXT,
  "academic_year_id" TEXT,
  "discount_type"    "DiscountType"    NOT NULL,
  "value"            INTEGER,
  "active"           BOOLEAN           NOT NULL DEFAULT true,
  "created_by"       TEXT              NOT NULL,
  "created_at"       TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3)      NOT NULL,

  CONSTRAINT "discount_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "discount_rules_school_id_idx"
  ON "discount_rules" ("school_id");

CREATE INDEX "discount_rules_school_id_student_id_idx"
  ON "discount_rules" ("school_id", "student_id");

ALTER TABLE "discount_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "discount_rules" FORCE  ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "discount_rules"
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

-- ─────────────────────────────────────────────────────────────────────────────
-- RBAC: add discount-rule permissions to the system admin role
-- ─────────────────────────────────────────────────────────────────────────────
--
-- discount-rule.* granted to admin; owner has '*' wildcard — no explicit entry
-- needed. Bursar role wire-up is deferred to slice 15; strings land now.
-- Idempotent: NOT ... @> guard prevents duplicate JSON entries on re-run.

UPDATE "roles"
SET "permissions" = "permissions" || '["discount-rule.read","discount-rule.create","discount-rule.update","discount-rule.deactivate"]'::jsonb
WHERE "key" = 'admin'
  AND "is_system" = true
  AND NOT ("permissions" @> '["discount-rule.read"]'::jsonb);
